-- AlterTable
ALTER TABLE "SimCard"
ADD COLUMN "current_balance" DECIMAL(6, 3) NOT NULL DEFAULT 0;
