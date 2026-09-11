-- Indexes and constraints that the Prisma schema language cannot express.
-- See docs/PLAN.md §4 and §7.

-- Full-text search over document titles, backing the documents table search
-- box (PLAN §9). The 'english' regconfig literal keeps the expression
-- IMMUTABLE, which is what makes it indexable.
CREATE INDEX "documents_title_fts_idx"
  ON "documents"
  USING GIN (to_tsvector('english', COALESCE("title", '')));

-- Exactly one default SMTP config per organization (PLAN §7). A partial
-- unique index enforces this in the database rather than in application code,
-- where a concurrent update could slip past a read-then-write check.
CREATE UNIQUE INDEX "smtp_configs_one_default_per_org_idx"
  ON "smtp_configs" ("org_id")
  WHERE "is_default";
