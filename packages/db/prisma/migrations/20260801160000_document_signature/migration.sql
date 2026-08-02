-- CreateTable
CREATE TABLE "document_signature" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "typedName" TEXT NOT NULL,
    "consentedToElectronicRecords" BOOLEAN NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "signedContentHash" TEXT NOT NULL,
    "signedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_signature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_signature_documentId_key" ON "document_signature"("documentId");

-- AddForeignKey
ALTER TABLE "document_signature" ADD CONSTRAINT "document_signature_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

