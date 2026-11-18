-- 18.11.2026: документ корректировки остатков (решение владельца, постановка —
-- docs/stock_correction_design.md).
--
-- Повод: на проде лежали минусовые остатки Массы (БП-00000178 −313, БП-00000370 −115),
-- а выравнивать их было нечем: история движений неизменяема, ручной корректировки в системе
-- не было вовсе (M05 BR-4). Документ не правит историю — он добавляет компенсирующее
-- движение с источником STOCK_ADJUSTMENT, поэтому существующие таблицы не меняются.
--
-- Номер документа берётся из последовательности, а не из MAX(number)+1: два НП, сохранившие
-- корректировку в одну секунду, иначе получили бы один номер.

CREATE SEQUENCE IF NOT EXISTS stock_adjustment_number_seq;

CREATE TYPE "StockAdjustmentDirection" AS ENUM ('RECEIPT', 'ISSUE');

CREATE TYPE "StockAdjustmentReason" AS ENUM (
  'INVENTORY',
  'ACCOUNTING_ERROR',
  'DAMAGE',
  'RESORT',
  'OTHER'
);

CREATE TABLE "stock_adjustments" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "reasonCode" "StockAdjustmentReason" NOT NULL,
    "reason" TEXT NOT NULL,
    "basisDocument" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "compensatesAdjustmentId" TEXT,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_adjustment_lines" (
    "id" TEXT NOT NULL,
    "adjustmentId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "stockCategory" "StockCategory" NOT NULL,
    "direction" "StockAdjustmentDirection" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "stock_adjustment_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_adjustments_number_key" ON "stock_adjustments"("number");
CREATE INDEX "stock_adjustments_createdAt_idx" ON "stock_adjustments"("createdAt");

ALTER TABLE "stock_adjustments"
  ADD CONSTRAINT "stock_adjustments_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_adjustments"
  ADD CONSTRAINT "stock_adjustments_compensatesAdjustmentId_fkey"
  FOREIGN KEY ("compensatesAdjustmentId") REFERENCES "stock_adjustments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_adjustment_lines"
  ADD CONSTRAINT "stock_adjustment_lines_adjustmentId_fkey"
  FOREIGN KEY ("adjustmentId") REFERENCES "stock_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_adjustment_lines"
  ADD CONSTRAINT "stock_adjustment_lines_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_adjustment_lines"
  ADD CONSTRAINT "stock_adjustment_lines_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
