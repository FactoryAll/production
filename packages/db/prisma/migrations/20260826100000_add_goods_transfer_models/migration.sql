-- Rename the transfer status enum to match the schema name.
ALTER TYPE "TransferStatus" RENAME TO "GoodsTransferStatus";

-- Add warehouse and submission columns to goods_transfers.
ALTER TABLE "goods_transfers"
ADD COLUMN "sourceWarehouseId" TEXT,
ADD COLUMN "destinationWarehouseId" TEXT,
ADD COLUMN "submittedAt" TIMESTAMP(3),
ADD COLUMN "submittedByUserId" TEXT;

-- Backfill any existing transfers with the seeded warehouse ids so the new
-- non-null constraints can be applied safely.
UPDATE "goods_transfers"
SET "sourceWarehouseId" = (SELECT id FROM warehouses WHERE type = 'PRODUCTION' LIMIT 1),
    "destinationWarehouseId" = (SELECT id FROM warehouses WHERE type = 'FINISHED_GOODS' LIMIT 1)
WHERE "sourceWarehouseId" IS NULL;

ALTER TABLE "goods_transfers"
ALTER COLUMN "sourceWarehouseId" SET NOT NULL,
ALTER COLUMN "destinationWarehouseId" SET NOT NULL;

-- Remove columns that are no longer part of the model.
ALTER TABLE "goods_transfers" DROP CONSTRAINT IF EXISTS "goods_transfers_createdById_fkey";
ALTER TABLE "goods_transfers" DROP COLUMN IF EXISTS "createdById";
ALTER TABLE "goods_transfers" DROP COLUMN IF EXISTS "sentAt";

-- Wire up new foreign keys.
ALTER TABLE "goods_transfers"
ADD CONSTRAINT "goods_transfers_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "goods_transfers_destinationWarehouseId_fkey" FOREIGN KEY ("destinationWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "goods_transfers_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrate transfer_lines to use goodsTransferId and add audit timestamps.
ALTER TABLE "transfer_lines"
ADD COLUMN "goodsTransferId" TEXT,
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "transfer_lines" SET "goodsTransferId" = "transferId" WHERE "goodsTransferId" IS NULL;

ALTER TABLE "transfer_lines"
ALTER COLUMN "goodsTransferId" SET NOT NULL;

ALTER TABLE "transfer_lines" DROP CONSTRAINT IF EXISTS "transfer_lines_transferId_fkey";
ALTER TABLE "transfer_lines" DROP COLUMN "transferId";

-- Match the Prisma schema precision for planned/actual quantities.
ALTER TABLE "transfer_lines"
ALTER COLUMN "plannedQuantity" TYPE DECIMAL(10,2),
ALTER COLUMN "actualQuantity" TYPE DECIMAL(10,2);

ALTER TABLE "transfer_lines"
ADD CONSTRAINT "transfer_lines_goodsTransferId_fkey" FOREIGN KEY ("goodsTransferId") REFERENCES "goods_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
