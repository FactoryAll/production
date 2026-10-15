-- CreateEnum
CREATE TYPE "NotificationScope" AS ENUM ('ALL', 'MASS', 'GP_TRANSFERS');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "notificationScope" "NotificationScope" NOT NULL DEFAULT 'ALL';
