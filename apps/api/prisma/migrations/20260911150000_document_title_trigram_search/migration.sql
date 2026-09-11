-- Make the documents search box indexable.
--
-- The dashboard searches titles as you type, so "inv" must match
-- "invoice-001". That is a substring match — ILIKE '%inv%' — and the
-- to_tsvector GIN index added in the first migration cannot serve it:
-- full-text search matches whole lexemes, so it would return nothing for a
-- partial word and the planner would fall back to a sequential scan anyway.
--
-- pg_trgm indexes the three-character sequences of a string, which is exactly
-- what an unanchored LIKE/ILIKE needs. Titles are short, so full-text ranking
-- buys nothing here; when document bodies become searchable, a tsvector index
-- over that content is the right tool and can be added alongside.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP INDEX IF EXISTS "documents_title_fts_idx";

CREATE INDEX "documents_title_trgm_idx"
  ON "documents"
  USING GIN ("title" gin_trgm_ops);
