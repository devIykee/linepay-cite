-- Optimistic chunk unlock (spec §3). A row is `optimistic` when the reader was
-- shown the chunk before its payment was confirmed (the payment settles in the
-- background / on the next-chunk combined check). Lets the sweep and the
-- combined-check distinguish an in-flight optimistic row from a normal pending
-- one — notably simulate-mode rows that carry no Gateway attestation.
ALTER TABLE payment_ledger ADD COLUMN IF NOT EXISTS optimistic BOOLEAN NOT NULL DEFAULT FALSE;
