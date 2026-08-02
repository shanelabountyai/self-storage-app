-- CreateEnum
CREATE TYPE "AccessEventResult" AS ENUM ('granted', 'denied');

-- CreateTable
CREATE TABLE "access_event" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "vendorEventId" TEXT NOT NULL,
    "credentialId" TEXT,
    "result" "AccessEventResult" NOT NULL,
    "reason" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulated_gate_code" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "simulated_gate_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulated_vendor_event" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "vendorEventId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulated_vendor_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_simulator_config" (
    "facilityId" TEXT NOT NULL,
    "offline" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "webhookFailing" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gate_simulator_config_pkey" PRIMARY KEY ("facilityId")
);

-- CreateIndex
CREATE UNIQUE INDEX "access_event_vendorEventId_key" ON "access_event"("vendorEventId");

-- CreateIndex
CREATE INDEX "access_event_facilityId_occurredAt_idx" ON "access_event"("facilityId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "simulated_gate_code_credentialId_key" ON "simulated_gate_code"("credentialId");

-- CreateIndex
CREATE INDEX "simulated_gate_code_facilityId_code_idx" ON "simulated_gate_code"("facilityId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "simulated_vendor_event_vendorEventId_key" ON "simulated_vendor_event"("vendorEventId");

-- CreateIndex
CREATE INDEX "simulated_vendor_event_facilityId_delivered_idx" ON "simulated_vendor_event"("facilityId", "delivered");

-- AddForeignKey
ALTER TABLE "access_event" ADD CONSTRAINT "access_event_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_event" ADD CONSTRAINT "access_event_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "access_credential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulated_gate_code" ADD CONSTRAINT "simulated_gate_code_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulated_vendor_event" ADD CONSTRAINT "simulated_vendor_event_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_simulator_config" ADD CONSTRAINT "gate_simulator_config_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

