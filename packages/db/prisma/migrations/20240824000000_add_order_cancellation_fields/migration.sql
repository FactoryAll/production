-- Add cancellation metadata to production_orders

ALTER TABLE "production_orders" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "production_orders" ADD COLUMN "cancelledByUserId" TEXT;
ALTER TABLE "production_orders" ADD COLUMN "cancellationReason" TEXT;

ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
