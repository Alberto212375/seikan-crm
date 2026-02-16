-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "city" TEXT,
ADD COLUMN     "clientDepuisLe" TIMESTAMP(3),
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "prospectedByEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prospectedByPhone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prospectedInPerson" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "siret" TEXT,
ADD COLUMN     "street" TEXT;
