-- CreateTable
CREATE TABLE "sms_incoming" (
    "id" SERIAL NOT NULL,
    "port" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "sms_incoming_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sms_incoming_port_idx" ON "sms_incoming"("port");
