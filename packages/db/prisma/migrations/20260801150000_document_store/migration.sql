-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('lease', 'receipt', 'notice', 'insurance_proof', 'id_copy', 'inspection_photo', 'lien_evidence', 'other');

-- CreateTable
CREATE TABLE "document" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "storageRef" TEXT,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_facilityId_type_idx" ON "document"("facilityId", "type");

-- CreateIndex
CREATE INDEX "document_subjectType_subjectId_idx" ON "document"("subjectType", "subjectId");

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

