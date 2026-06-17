import { gatewayAddressFor } from "@/lib/agent-skills";
import { bumpCounter } from "@/lib/store";

export const runtime = "nodejs";

/**
 * Agent self-discovery manifest. Exposed at /.well-known/agent-payment.json via
 * a rewrite (see next.config.mjs). Lets a crawling agent discover the payment
 * protocol, gateway address, and content URL pattern.
 */
export async function GET() {
  void bumpCounter("wellknown_hit");
  const gateway = gatewayAddressFor({ gateway_address: null });
  const costPerBlock = process.env.DEFAULT_PRICE_PER_BLOCK || "0.05";

  const manifest = {
    version: "1.0",
    payment_protocol: "circle-gateway-eip3009",
    currency: "USDC",
    gateway_address: gateway,
    content_endpoints: [
      {
        type: "agent-skills",
        url_pattern: "/read/{slug}/agent-skills.md",
        free_block: 0,
        cost_per_block: costPerBlock,
        auth_header: "X-Payment-Token",
      },
    ],
    marketplace: "/marketplace",
    docs: "/read/agent-skills.md",
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
