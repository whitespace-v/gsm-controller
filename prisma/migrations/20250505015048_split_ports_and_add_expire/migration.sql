/*
  Warnings:

  - You are about to drop the column `port` on the `sms_incoming` table. All the data in the column will be lost.
  - You are about to drop the column `received_at` on the `sms_incoming` table. All the data in the column will be lost.
  - Added the required column `modemPortId` to the `sms_incoming` table without a default value. This is not possible if the table is not empty.
  - Added the required column `receive_at` to the `sms_incoming` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "sms_incoming_port_idx";

-- AlterTable
ALTER TABLE "sms_incoming" DROP COLUMN "port",
DROP COLUMN "received_at",
ADD COLUMN     "expire" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "modemPortId" INTEGER NOT NULL,
ADD COLUMN     "receive_at" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "modem_port" (
    "id" SERIAL NOT NULL,
    "port" TEXT NOT NULL,
    "phone" TEXT NOT NULL,

    CONSTRAINT "modem_port_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "modem_port_port_key" ON "modem_port"("port");

-- CreateIndex
CREATE UNIQUE INDEX "modem_port_phone_key" ON "modem_port"("phone");

-- CreateIndex
CREATE INDEX "sms_incoming_modemPortId_expire_idx" ON "sms_incoming"("modemPortId", "expire");

-- AddForeignKey
ALTER TABLE "sms_incoming" ADD CONSTRAINT "sms_incoming_modemPortId_fkey" FOREIGN KEY ("modemPortId") REFERENCES "modem_port"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
