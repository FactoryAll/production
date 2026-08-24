-- Add stopsCount and reported metadata to ProductionFact
-- and enforce one fact per production order line.
ALTER TABLE "production_facts" ADD COLUMN "stopsCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "production_facts" ADD COLUMN "reportedAt" TIMESTAMP(3);
ALTER TABLE "production_facts" ADD COLUMN "reportedByUserId" TEXT;

-- Enforce one ProductionFact per ProductionOrderLine.
CREATE UNIQUE INDEX "production_facts_lineId_key" ON "production_facts"("lineId");
