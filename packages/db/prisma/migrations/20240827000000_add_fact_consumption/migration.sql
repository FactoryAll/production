-- Create FactConsumption table for raw-material / semi-finished consumption per fact.
CREATE TABLE "fact_consumptions" (
    "id" TEXT NOT NULL,
    "productionFactId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(10, 2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_consumptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fact_consumptions_productionFactId_productId_key" ON "fact_consumptions"("productionFactId", "productId");

ALTER TABLE "fact_consumptions" ADD CONSTRAINT "fact_consumptions_productionFactId_fkey" FOREIGN KEY ("productionFactId") REFERENCES "production_facts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fact_consumptions" ADD CONSTRAINT "fact_consumptions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
