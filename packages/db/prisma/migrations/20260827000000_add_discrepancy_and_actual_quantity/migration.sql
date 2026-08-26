-- Drop the old discrepancies table (it had a nullable FK to goods_transfers
-- and no product relation) and recreate with the T-041 structure.
DROP TABLE IF EXISTS "discrepancies";

-- Ensure transfer_lines already has actualQuantity at DECIMAL(10,2).
ALTER TABLE "transfer_lines"
ALTER COLUMN "actualQuantity" TYPE DECIMAL(10,2);

-- Recreate discrepancies with goodsTransferId as non-nullable FK,
-- productId FK, difference, reconciled fields and unique constraint.
CREATE TABLE "discrepancies" (
    "id" TEXT NOT NULL,
    "goodsTransferId" TEXT NOT NULL,
    "transferLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "plannedQuantity" DECIMAL(10,2) NOT NULL,
    "actualQuantity" DECIMAL(10,2) NOT NULL,
    "difference" DECIMAL(10,2) NOT NULL,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "reconciledAt" TIMESTAMP(3),
    "reconciledByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discrepancies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "discrepancies_goodsTransferId_transferLineId_key" ON "discrepancies"("goodsTransferId", "transferLineId");

ALTER TABLE "discrepancies"
ADD CONSTRAINT "discrepancies_goodsTransferId_fkey" FOREIGN KEY ("goodsTransferId") REFERENCES "goods_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "discrepancies_transferLineId_fkey" FOREIGN KEY ("transferLineId") REFERENCES "transfer_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "discrepancies_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "discrepancies_reconciledByUserId_fkey" FOREIGN KEY ("reconciledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
