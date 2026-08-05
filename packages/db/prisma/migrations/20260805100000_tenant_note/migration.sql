-- CreateTable
CREATE TABLE "tenant_note" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_note_tenantId_pinned_createdAt_idx" ON "tenant_note"("tenantId", "pinned", "createdAt");

-- AddForeignKey
ALTER TABLE "tenant_note" ADD CONSTRAINT "tenant_note_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_note" ADD CONSTRAINT "tenant_note_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_note" ADD CONSTRAINT "tenant_note_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
