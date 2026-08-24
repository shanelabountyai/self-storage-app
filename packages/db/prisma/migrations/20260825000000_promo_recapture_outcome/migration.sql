-- AlterTable
ALTER TABLE "promo_redemption" ADD COLUMN     "recaptureChargedCents" INTEGER,
ADD COLUMN     "recaptureInvoiceId" TEXT,
ADD COLUMN     "recaptureWaivedCents" INTEGER;

-- AddForeignKey
ALTER TABLE "promo_redemption" ADD CONSTRAINT "promo_redemption_recaptureInvoiceId_fkey" FOREIGN KEY ("recaptureInvoiceId") REFERENCES "invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

