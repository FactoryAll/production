-- Drop legacy read-side model
DROP TABLE IF EXISTS "production_fact_consumptions" CASCADE;

-- Recreate stock tables with the T-035 schema (drop old shape to allow enum rename and new columns)
DROP TABLE IF EXISTS "stock_movements" CASCADE;
DROP TABLE IF EXISTS "stock_balances" CASCADE;
DROP TYPE IF EXISTS "StockMovementType" CASCADE;
DROP TYPE IF EXISTS "StockCategory" CASCADE;

-- Enums
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ISSUE', 'CONSUMPTION', 'RETURN');
CREATE TYPE "StockCategory" AS ENUM ('MASS', 'PF', 'GP');

-- Movement journal (source of truth)
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "stockCategory" "StockCategory" NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_movements_warehouseId_productId_stockCategory_idx" ON "stock_movements"("warehouseId", "productId", "stockCategory");

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Materialized balance
CREATE TABLE "stock_balances" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "stockCategory" "StockCategory" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_balances_warehouseId_productId_stockCategory_key" ON "stock_balances"("warehouseId", "productId", "stockCategory");

ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
