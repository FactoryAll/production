
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "confirmedByUserId" TEXT;
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "cancelledByUserId" TEXT;
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;
