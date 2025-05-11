-- CreateTable
CREATE TABLE "SmsIncoming" (
    "id" SERIAL NOT NULL,
    "modemDeviceId" INTEGER NOT NULL,
    "simCardId" INTEGER NOT NULL,
    "sender" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,
    "expire" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SmsIncoming_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsIncoming_modemDeviceId_expire_idx" ON "SmsIncoming"("modemDeviceId", "expire");

-- CreateIndex
CREATE INDEX "SmsIncoming_simCardId_expire_idx" ON "SmsIncoming"("simCardId", "expire");

-- AddForeignKey
ALTER TABLE "SmsIncoming" ADD CONSTRAINT "SmsIncoming_modemDeviceId_fkey" FOREIGN KEY ("modemDeviceId") REFERENCES "ModemDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsIncoming" ADD CONSTRAINT "SmsIncoming_simCardId_fkey" FOREIGN KEY ("simCardId") REFERENCES "SimCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
