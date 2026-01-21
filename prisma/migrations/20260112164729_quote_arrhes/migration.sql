-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "depositPaid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "depositPaidAmount" INTEGER NOT NULL DEFAULT 0;
