-- CreateEnum
CREATE TYPE "ConsignmentStatus" AS ENUM ('DRAFT', 'GENERATED', 'SIGNED', 'CLOSED');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'CONSIGNMENT_PDF';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "consignmentId" TEXT;

-- CreateTable
CREATE TABLE "Consignment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "seq" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "status" "ConsignmentStatus" NOT NULL DEFAULT 'DRAFT',
    "signedAt" TIMESTAMP(3),
    "clientId" TEXT NOT NULL,
    "depositDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recoveryDate" TIMESTAMP(3) NOT NULL,
    "periodDays" INTEGER NOT NULL,
    "emailSentAt" TIMESTAMP(3),
    "emailSentCount" INTEGER NOT NULL DEFAULT 0,
    "clientName" TEXT NOT NULL,
    "clientEmail" TEXT,
    "clientPhone" TEXT,
    "clientAddress" TEXT,

    CONSTRAINT "Consignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsignmentItem" (
    "id" TEXT NOT NULL,
    "consignmentId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "nameFR" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ConsignmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Consignment_seq_key" ON "Consignment"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "Consignment_number_key" ON "Consignment"("number");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_consignmentId_fkey" FOREIGN KEY ("consignmentId") REFERENCES "Consignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consignment" ADD CONSTRAINT "Consignment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentItem" ADD CONSTRAINT "ConsignmentItem_consignmentId_fkey" FOREIGN KEY ("consignmentId") REFERENCES "Consignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
