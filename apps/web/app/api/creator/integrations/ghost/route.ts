import { NextRequest } from "next/server";
import { assertNotImpersonating, errorResponse, resolveActingUser } from "@/lib/session";
import {
  deleteGhostIntegration,
  getGhostIntegration,
  updateGhostOptions,
  upsertGhostIntegration,
} from "@/lib/store";
import { encryptSecret, secretsEnabled } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appUrl(req: NextRequest): string {
  return (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");
}

/**
 * Public (client-safe) view of a creator's Ghost integration. CRITICAL: never
 * include the Content or Admin API keys — only whether they're set, the status,
 * the toggles, and the webhook URL the creator must paste into Ghost.
 */
function publicView(req: NextRequest, creatorId: string, row: Awaited<ReturnType<typeof getGhostIntegration>>) {
  const webhookUrl = `${appUrl(req)}/api/webhooks/ghost?creator=${creatorId}`;
  if (!row) {
    return {
      connected: false,
      siteUrl: "",
      hasContentKey: false,
      hasAdminKey: false,
      defaultMonetization: "paid" as const,
      autoPublish: false,
      connectionStatus: "unconnected" as const,
      lastError: null as string | null,
      lastEventAt: null as string | null,
      webhookUrl,
    };
  }
  return {
    connected: true,
    siteUrl: row.site_url,
    hasContentKey: !!row.content_api_key_enc,
    hasAdminKey: !!row.admin_api_key_enc,
    defaultMonetization: row.default_monetization,
    autoPublish: row.auto_publish,
    connectionStatus: row.connection_status,
    lastError: row.last_error,
    lastEventAt: row.last_event_at ? new Date(row.last_event_at).toISOString() : null,
    webhookUrl,
  };
}

/** GET — the acting creator's Ghost integration (no secrets). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveActingUser();
    const row = await getGhostIntegration(ctx.user.id);
    return Response.json({ integration: publicView(req, ctx.user.id, row), encryptionReady: secretsEnabled() });
  } catch (e) {
    return errorResponse(e);
  }
}

/** PUT — save credentials and/or options. Keys are encrypted before storage. */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await resolveActingUser();
    assertNotImpersonating(ctx);
    const creatorId = ctx.user.id;

    const body = (await req.json().catch(() => ({}))) as {
      siteUrl?: string;
      contentApiKey?: string;
      adminApiKey?: string;
      defaultMonetization?: "free" | "paid";
      autoPublish?: boolean;
    };

    const existing = await getGhostIntegration(creatorId);

    // Options-only update (no new credentials) — allowed without re-pasting keys.
    const hasNewCreds = !!(body.contentApiKey || body.adminApiKey || body.siteUrl);
    if (!hasNewCreds && existing) {
      const updated = await updateGhostOptions(creatorId, {
        defaultMonetization: body.defaultMonetization,
        autoPublish: typeof body.autoPublish === "boolean" ? body.autoPublish : undefined,
      });
      return Response.json({ integration: publicView(req, creatorId, updated), encryptionReady: secretsEnabled() });
    }

    if (!secretsEnabled()) {
      return Response.json(
        { error: "encryption_unavailable", message: "Set INTEGRATION_ENC_KEY on the server before connecting Ghost." },
        { status: 503 }
      );
    }

    // Full save requires all three fields (or reuse the existing creds when only
    // toggles + site changed and the creator left key fields blank).
    const siteUrl = (body.siteUrl ?? existing?.site_url ?? "").trim().replace(/\/$/, "");
    if (!/^https?:\/\/.+/i.test(siteUrl)) {
      return Response.json({ error: "invalid_site", message: "Enter your Ghost site URL (https://…)." }, { status: 400 });
    }

    let contentEnc = existing?.content_api_key_enc;
    let adminEnc = existing?.admin_api_key_enc;
    if (body.contentApiKey) contentEnc = encryptSecret(body.contentApiKey.trim());
    if (body.adminApiKey) adminEnc = encryptSecret(body.adminApiKey.trim());
    if (!contentEnc || !adminEnc) {
      return Response.json(
        { error: "missing_keys", message: "Both the Content API key and Admin API key are required to connect." },
        { status: 400 }
      );
    }

    const saved = await upsertGhostIntegration({
      creatorId,
      siteUrl,
      contentApiKeyEnc: contentEnc,
      adminApiKeyEnc: adminEnc,
      defaultMonetization: body.defaultMonetization ?? existing?.default_monetization ?? "paid",
      autoPublish: typeof body.autoPublish === "boolean" ? body.autoPublish : existing?.auto_publish ?? false,
    });
    return Response.json({ integration: publicView(req, creatorId, saved), encryptionReady: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE — disconnect Ghost (removes stored credentials). */
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await resolveActingUser();
    assertNotImpersonating(ctx);
    await deleteGhostIntegration(ctx.user.id);
    return Response.json({ integration: publicView(req, ctx.user.id, undefined) });
  } catch (e) {
    return errorResponse(e);
  }
}
