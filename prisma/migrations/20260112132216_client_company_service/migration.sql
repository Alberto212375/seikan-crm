/*
  Warnings:

  - You are about to drop the column `city` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `firstName` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `lastName` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `postalCode` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `street` on the `Client` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Client" DROP COLUMN "city",
DROP COLUMN "firstName",
DROP COLUMN "lastName",
DROP COLUMN "postalCode",
DROP COLUMN "street",
ADD COLUMN     "serviceName" TEXT;
