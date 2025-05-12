/*
  Warnings:

  - You are about to drop the `SmsIncoming` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "SimRole" AS ENUM ('TWO_FA', 'BANK', 'UNIVERSAL');

-- DropForeignKey
ALTER TABLE "SmsIncoming" DROP CONSTRAINT "SmsIncoming_modemDeviceId_fkey";

-- DropForeignKey
ALTER TABLE "SmsIncoming" DROP CONSTRAINT "SmsIncoming_simCardId_fkey";

-- AlterTable
ALTER TABLE "SimCard" ADD COLUMN     "busy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
ADD COLUMN     "role" "SimRole" NOT NULL DEFAULT 'UNIVERSAL';

-- DropTable
DROP TABLE "SmsIncoming";

-- CreateTable
CREATE TABLE "SmsIncomingHistory" (
    "id" SERIAL NOT NULL,
    "modemDeviceId" INTEGER NOT NULL,
    "simCardId" INTEGER NOT NULL,
    "sender" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "SmsIncomingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsIncomingHistory_modemDeviceId_idx" ON "SmsIncomingHistory"("modemDeviceId");

-- CreateIndex
CREATE INDEX "SmsIncomingHistory_simCardId_idx" ON "SmsIncomingHistory"("simCardId");

-- AddForeignKey
ALTER TABLE "SmsIncomingHistory" ADD CONSTRAINT "SmsIncomingHistory_modemDeviceId_fkey" FOREIGN KEY ("modemDeviceId") REFERENCES "ModemDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsIncomingHistory" ADD CONSTRAINT "SmsIncomingHistory_simCardId_fkey" FOREIGN KEY ("simCardId") REFERENCES "SimCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
