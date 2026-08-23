-- T-016: auth session user agent, User.active, LOGIN_FAILED audit action

-- CreateEnumValue
ALTER TYPE "AuditAction" ADD VALUE 'LOGIN_FAILED';

-- AlterTable
ALTER TABLE "users" DROP COLUMN "blocked",
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "userAgent" TEXT;

-- CreateIndex
CREATE INDEX "sessions_expiresAt_index" ON "sessions"("expiresAt");
