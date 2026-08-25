-- Drop previous unique constraint that allowed only one fact per line.
DROP INDEX "production_facts_lineId_key";

-- Allow one fact per (lineId, factCategory) so GP and PF can coexist.
CREATE UNIQUE INDEX "production_facts_lineId_factCategory_key" ON "production_facts"("lineId", "factCategory");
