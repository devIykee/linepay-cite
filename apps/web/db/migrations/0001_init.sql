-- LinePay Cite — initial Postgres schema (chunk-based, production).
-- Replaces the legacy line-based SQLite schema. All monetary amounts are
-- NUMERIC(18,6) USDC (6 decimals — the Arc/Circle USDC precision).
--
-- Run with: npm run db:migrate   (see apps/web/lib/db.ts)

-- gen_random_uuid() lives in pgcrypto on older PG; built-in from PG 13+.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Users (creators + admins) ───────────────────────────────────────────────
-- Created on first OAuth login. `role` is 'creator' by default, auto-promoted
-- to 'admin' when the login email matches ADMIN_EMAIL.
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT UNIQUE NOT NULL,
  name           TEXT,
  avatar         TEXT,
  provider       TEXT,                                   -- 'google' | 'github' | 'twitter'
  wallet_address TEXT,                                   -- EIP-55 checksummed, validated server-side
  role           TEXT NOT NULL DEFAULT 'creator',        -- 'creator' | 'admin'
  handle         TEXT UNIQUE,                            -- public slug, e.g. @ada_writes
  display_name   TEXT,
  verified       BOOLEAN NOT NULL DEFAULT FALSE,
  suspended      BOOLEAN NOT NULL DEFAULT FALSE,
  last_active_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

-- ── Content ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug             TEXT UNIQUE NOT NULL,
  title            TEXT NOT NULL,
  summary          TEXT NOT NULL DEFAULT '',
  tags             TEXT NOT NULL DEFAULT '',            -- comma separated
  content_type     TEXT NOT NULL DEFAULT 'article',     -- 'article' | 'agent-skills'
  body             TEXT NOT NULL,                        -- source markdown/article text
  price_per_block  NUMERIC(18,6) NOT NULL DEFAULT 0,     -- USDC per payable block
  gateway_address  TEXT,                                 -- Circle Gateway address used in block 0
  status           TEXT NOT NULL DEFAULT 'draft',        -- 'draft' | 'published' | 'suspended'
  suspended_reason TEXT,
  block_count      INTEGER NOT NULL DEFAULT 0,           -- payable blocks (excludes free block 0)
  view_count       INTEGER NOT NULL DEFAULT 0,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Full-text search vector over title + summary + tags (see trigger below).
  search_tsv       TSVECTOR
);
CREATE INDEX IF NOT EXISTS content_creator_idx ON content (creator_id);
CREATE INDEX IF NOT EXISTS content_status_idx  ON content (status);
CREATE INDEX IF NOT EXISTS content_type_idx    ON content (content_type);
CREATE INDEX IF NOT EXISTS content_search_idx  ON content USING GIN (search_tsv);

-- Maintain search_tsv automatically on insert/update.
CREATE OR REPLACE FUNCTION content_search_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(replace(NEW.tags, ',', ' '), '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS content_search_tsv_trg ON content;
CREATE TRIGGER content_search_tsv_trg
  BEFORE INSERT OR UPDATE OF title, summary, tags ON content
  FOR EACH ROW EXECUTE FUNCTION content_search_tsv_update();

-- ── Chunks (payable blocks) ─────────────────────────────────────────────────
-- block_index 0 is always the free onboarding/preview block.
CREATE TABLE IF NOT EXISTS chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id  UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  block_index INTEGER NOT NULL,
  text        TEXT NOT NULL,
  is_free     BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (content_id, block_index)
);
CREATE INDEX IF NOT EXISTS chunks_content_idx ON chunks (content_id);

-- ── Payment ledger ──────────────────────────────────────────────────────────
-- Every unlock (human or agent) writes a row here BEFORE returning content.
-- Rows start 'pending' and finalize to 'completed' on Circle webhook
-- confirmation (or immediately in simulate mode).
CREATE TABLE IF NOT EXISTS payment_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id      UUID REFERENCES content(id) ON DELETE SET NULL,
  creator_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  payer_id        TEXT,                                  -- wallet address or 'agent:<session>'
  payer_kind      TEXT NOT NULL DEFAULT 'human',         -- 'human' | 'agent'
  block_index     INTEGER,
  gross_amount    NUMERIC(18,6) NOT NULL,
  creator_amount  NUMERIC(18,6) NOT NULL,
  platform_amount NUMERIC(18,6) NOT NULL,
  referrer_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  referrer_id     TEXT,
  payment_token   TEXT,                                  -- X-Payment-Token (idempotency key)
  tx_hash         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',       -- 'pending' | 'completed' | 'failed'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ledger_creator_idx ON payment_ledger (creator_id);
CREATE INDEX IF NOT EXISTS ledger_content_idx ON payment_ledger (content_id);
CREATE INDEX IF NOT EXISTS ledger_status_idx  ON payment_ledger (status);
CREATE INDEX IF NOT EXISTS ledger_created_idx ON payment_ledger (created_at DESC);
-- One ledger row per payment token (idempotency for retried agent requests).
CREATE UNIQUE INDEX IF NOT EXISTS ledger_token_uidx
  ON payment_ledger (payment_token) WHERE payment_token IS NOT NULL;

-- ── Payouts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payouts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount         NUMERIC(18,6) NOT NULL,
  wallet_address TEXT NOT NULL,
  tx_hash        TEXT,
  status         TEXT NOT NULL DEFAULT 'initiated',      -- 'initiated' | 'confirmed' | 'failed'
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS payouts_creator_idx ON payouts (creator_id);

-- ── Admin event stream ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   TEXT NOT NULL,
  actor_id     UUID,
  payer_id     TEXT,
  content_id   UUID,
  block_index  INTEGER,
  amount_gross NUMERIC(18,6),
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_events_created_idx ON admin_events (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_events_type_idx    ON admin_events (event_type);

-- ── Agent sessions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_sessions (
  session_key      TEXT PRIMARY KEY,
  ip               TEXT,
  user_agent       TEXT,
  label            TEXT,
  notes            TEXT,
  trusted          BOOLEAN DEFAULT FALSE,
  blocked          BOOLEAN DEFAULT FALSE,
  first_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_402_hits   INTEGER DEFAULT 0,
  total_unlocks    INTEGER DEFAULT 0,
  total_spent_usdc NUMERIC(18,6) DEFAULT 0
);

-- ── Async CSV export jobs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS export_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID NOT NULL,
  filters      JSONB,
  status       TEXT NOT NULL DEFAULT 'pending',          -- 'pending' | 'processing' | 'complete' | 'failed'
  row_count    INTEGER,
  file_path    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
