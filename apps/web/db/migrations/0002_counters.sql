-- Lightweight named counters for the agent discovery funnel
-- (well-known hits, block-0 fetches) — cheap UPSERTs on hot paths.
CREATE TABLE IF NOT EXISTS counters (
  key   TEXT PRIMARY KEY,
  value BIGINT NOT NULL DEFAULT 0
);
