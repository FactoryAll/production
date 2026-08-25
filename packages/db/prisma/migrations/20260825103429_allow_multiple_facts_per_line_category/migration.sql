-- Drop previous unique constraint/index that allowed only one fact per line (if it exists).
DROP INDEX IF EXISTS "production_facts_lineId_key";

-- Allow one fact per (lineId, factCategory) so GP and PF can coexist.
CREATE UNIQUE INDEX IF NOT EXISTS "production_facts_lineId_factCategory_key" ON "production_facts"("lineId", "factCategory");
