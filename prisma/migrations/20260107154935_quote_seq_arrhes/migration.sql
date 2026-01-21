/*
  Warnings:

  - A unique constraint covering the columns `[seq]` on the table `Quote` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `balanceHT` to the `Quote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `clientName` to the `Quote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `depositHT` to the `Quote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `seq` to the `Quote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalHT` to the `Quote` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "balanceHT" INTEGER NOT NULL,
ADD COLUMN     "clientAddress" TEXT,
ADD COLUMN     "clientEmail" TEXT,
ADD COLUMN     "clientName" TEXT NOT NULL,
ADD COLUMN     "clientPhone" TEXT,
ADD COLUMN     "clientService" TEXT,
ADD COLUMN     "depositHT" INTEGER NOT NULL,
ADD COLUMN     "depositPct" INTEGER NOT NULL DEFAULT 35,
ADD COLUMN     "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "metaJson" TEXT,
ADD COLUMN     "seq" INTEGER NOT NULL,
ADD COLUMN     "totalHT" INTEGER NOT NULL,
ADD COLUMN     "validDays" INTEGER NOT NULL DEFAULT 30;

-- CreateIndex
CREATE UNIQUE INDEX "Quote_seq_key" ON "Quote"("seq");
