DROP TABLE IF EXISTS "shift_summaries" CASCADE;
DROP TABLE IF EXISTS "shift_summary_consumptions" CASCADE;

CREATE TABLE "shift_summaries" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL,
    "massOutput" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pfOutput" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "gpOutput" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "defectQuantity" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "stopsCount" INTEGER NOT NULL DEFAULT 0,
    "stopsDurationMinutes" INTEGER NOT NULL DEFAULT 0,
    "plannedQuantity" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "plannedProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_summaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shift_summaries_productionOrderId_workCenterId_key" ON "shift_summaries"("productionOrderId", "workCenterId");

ALTER TABLE "shift_summaries" ADD CONSTRAINT "shift_summaries_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shift_summaries" ADD CONSTRAINT "shift_summaries_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_summaries" ADD CONSTRAINT "shift_summaries_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "work_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "shift_summary_consumptions" (
    "id" TEXT NOT NULL,
    "shiftSummaryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "shift_summary_consumptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shift_summary_consumptions_shiftSummaryId_productId_key" ON "shift_summary_consumptions"("shiftSummaryId", "productId");

ALTER TABLE "shift_summary_consumptions" ADD CONSTRAINT "shift_summary_consumptions_shiftSummaryId_fkey" FOREIGN KEY ("shiftSummaryId") REFERENCES "shift_summaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shift_summary_consumptions" ADD CONSTRAINT "shift_summary_consumptions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
