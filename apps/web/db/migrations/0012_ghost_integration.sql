-- Ghost CMS integration + in-app notifications.
--
-- A creator connects their Ghost blog once (Integrations settings). When they
-- publish on Ghost, Ghost fires a "Post published" webhook to
-- /api/webhooks/ghost; we validate its HMAC signature, fetch the full post via
-- the Content API, split it into Skimflow blocks, and either save it as a draft
-- or auto-publish it. Credentials are stored ENCRYPTED at rest (lib/secrets.ts,
-- AES-256-GCM) — the Admin API key never leaves the server in plaintext.

-- One Ghost connection per creator.
CREATE TABLE IF NOT EXISTS ghost_integrations (
  creator_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  site_url             TEXT NOT NULL,                     -- e.g. https://myblog.ghost.io (no trailing slash)
  -- Credentials, AES-256-GCM encrypted (iv:tag:ciphertext base64 — see lib/secrets.ts).
  content_api_key_enc  TEXT NOT NULL,                     -- Ghost Content API key (read-only)
  admin_api_key_enc    TEXT NOT NULL,                     -- Ghost Admin API key ("{id}:{secret}") — webhook HMAC secret
  default_monetization TEXT NOT NULL DEFAULT 'paid',      -- 'free' | 'paid' (pay-per-block)
  auto_publish         BOOLEAN NOT NULL DEFAULT FALSE,    -- OFF → land in drafts; ON → publish immediately
  connection_status    TEXT NOT NULL DEFAULT 'unconnected', -- 'unconnected' | 'connected' | 'error'
  last_error           TEXT,                              -- human-readable reason when status='error'
  last_event_at        TIMESTAMPTZ,                       -- last successfully processed webhook
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency map: a Ghost post is processed at most once. Ghost can fire the
-- same "post.published" webhook more than once; the unique ghost_post_id makes a
-- repeat a no-op (the receiver looks this up before doing any work).
CREATE TABLE IF NOT EXISTS ghost_post_map (
  ghost_post_id  TEXT PRIMARY KEY,                        -- Ghost's post id
  creator_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id     UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE, -- the Skimflow post it became
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ghost_post_map_creator_idx ON ghost_post_map (creator_id);

-- Lightweight in-app notifications (e.g. "New post from Ghost is ready to review").
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                              -- e.g. 'ghost_draft', 'ghost_published'
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  link        TEXT,                                       -- optional in-app link (e.g. /dashboard?tab=content)
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, read, created_at DESC);
