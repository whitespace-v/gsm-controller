/*
  Warnings:

  - You are about to drop the `modem_port` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `sms_incoming` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "sms_incoming" DROP CONSTRAINT "sms_incoming_modemPortId_fkey";

-- DropTable
DROP TABLE "modem_port";

-- DropTable
DROP TABLE "sms_incoming";

-- CreateTable
CREATE TABLE "ModemDevice" (
    "id" SERIAL NOT NULL,
    "imei" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentSimId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModemDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimCard" (
    "id" SERIAL NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModemSimHistory" (
    "id" SERIAL NOT NULL,
    "modemId" INTEGER NOT NULL,
    "simId" INTEGER NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),

    CONSTRAINT "ModemSimHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModemDevice_imei_key" ON "ModemDevice"("imei");

-- CreateIndex
CREATE UNIQUE INDEX "ModemDevice_serialNumber_key" ON "ModemDevice"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SimCard_phoneNumber_key" ON "SimCard"("phoneNumber");

-- AddForeignKey
ALTER TABLE "ModemDevice" ADD CONSTRAINT "ModemDevice_currentSimId_fkey" FOREIGN KEY ("currentSimId") REFERENCES "SimCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModemSimHistory" ADD CONSTRAINT "ModemSimHistory_modemId_fkey" FOREIGN KEY ("modemId") REFERENCES "ModemDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModemSimHistory" ADD CONSTRAINT "ModemSimHistory_simId_fkey" FOREIGN KEY ("simId") REFERENCES "SimCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
