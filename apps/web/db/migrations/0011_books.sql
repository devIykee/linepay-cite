-- Skimflow Books — long-form serialized content (Book → Chapters → Pages).
--
-- The book PARENT reuses a `content` row (content_type='book') so the proven
-- payment ledger, revenue-split, reader-pay, marketplace, search and moderation
-- paths work unchanged (payment_ledger.content_id and chunks.content_id both FK
-- to content(id); a separate books table would break those FKs). A dedicated
-- `chapters` table gives the real nested hierarchy; PAGES are `chunks` rows (one
-- page = one chunk = one payable screen) linked to their chapter via chapter_id.
--
-- content_type is plain TEXT (no CHECK constraint), so adding 'book' needs no
-- schema change beyond the TS union — only the new column + table + FK below.

-- Book cover image (book parent only; description reuses content.summary).
ALTER TABLE content ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

-- Chapters: ordered groups of pages within a book.
CREATE TABLE IF NOT EXISTS chapters (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id    UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL,            -- 0-based order within the book
  title         TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (content_id, chapter_index)
);
CREATE INDEX IF NOT EXISTS chapters_content_idx ON chapters (content_id);

-- A page (chunk) belongs to a chapter. NULL for non-book content.
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS chapter_id UUID REFERENCES chapters(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS chunks_chapter_idx ON chunks (chapter_id);
