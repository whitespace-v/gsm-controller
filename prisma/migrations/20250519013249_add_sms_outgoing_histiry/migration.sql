-- Set Timezone
SET
    TIMEZONE = 'Asia/Vladivostok';

-- AlterTable
ALTER TABLE "SimCard"
ALTER COLUMN "current_balance"
SET
    DATA TYPE DECIMAL(6, 2);

-- CreateTable
CREATE TABLE "SmsOutgoingHistory" (
    "id" SERIAL NOT NULL,
    "modemDeviceId" INTEGER NOT NULL,
    "simCardId" INTEGER NOT NULL,
    "recipient" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    CONSTRAINT "SmsOutgoingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsOutgoingHistory_modemDeviceId_idx" ON "SmsOutgoingHistory" ("modemDeviceId");

-- CreateIndex
CREATE INDEX "SmsOutgoingHistory_simCardId_idx" ON "SmsOutgoingHistory" ("simCardId");

-- AddForeignKey
ALTER TABLE "SmsOutgoingHistory" ADD CONSTRAINT "SmsOutgoingHistory_modemDeviceId_fkey" FOREIGN KEY ("modemDeviceId") REFERENCES "ModemDevice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsOutgoingHistory" ADD CONSTRAINT "SmsOutgoingHistory_simCardId_fkey" FOREIGN KEY ("simCardId") REFERENCES "SimCard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
