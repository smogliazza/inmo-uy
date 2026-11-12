-- Uruguay property schema (spec section 6). Additive only: new columns are optional or defaulted,
-- the only change to existing columns is dropping NOT NULL. Every statement can run twice.

-- 6.1 Property: relax required columns
ALTER TABLE "Property" ALTER COLUMN "state" DROP NOT NULL;
ALTER TABLE "Property" ALTER COLUMN "zip"   DROP NOT NULL;
ALTER TABLE "Property" ALTER COLUMN "price" DROP NOT NULL;
ALTER TABLE "Property" ALTER COLUMN "beds"  DROP NOT NULL;
ALTER TABLE "Property" ALTER COLUMN "baths" DROP NOT NULL;

-- Enums
DO $$ BEGIN CREATE TYPE "GeoPrecision" AS ENUM ('EXACT', 'APPROX', 'HIDDEN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AreaUnit" AS ENUM ('M2', 'HA'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "Operation" AS ENUM ('SALE', 'RENT', 'SEASONAL_RENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "RentPeriod" AS ENUM ('MONTH', 'WEEK', 'NIGHT', 'SEASON'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "IdDocumentType" AS ENUM ('CI', 'RUT', 'PASSPORT', 'OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE "PropStatus" ADD VALUE IF NOT EXISTS 'RESERVED';
ALTER TYPE "PropStatus" ADD VALUE IF NOT EXISTS 'RENTED';
ALTER TYPE "ClientType" ADD VALUE IF NOT EXISTS 'OWNER';
ALTER TYPE "ClientType" ADD VALUE IF NOT EXISTS 'TENANT';

-- 6.2 Property: new optional columns
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "locality" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "geoPrecision" "GeoPrecision" NOT NULL DEFAULT 'EXACT';
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "builtAreaM2" DOUBLE PRECISION;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "landArea" DOUBLE PRECISION;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "landAreaUnit" "AreaUnit";
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "garageSpaces" INTEGER;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "amenities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "hoaFeeCurrency" "Currency";
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "padron" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "furnished" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "externalSource" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "externalUrl" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "importedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "Property_orgId_code_key" ON "Property"("orgId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "Property_orgId_externalSource_externalId_key" ON "Property"("orgId", "externalSource", "externalId");
CREATE INDEX IF NOT EXISTS "Property_orgId_isPublic_status_idx" ON "Property"("orgId", "isPublic", "status");
CREATE INDEX IF NOT EXISTS "Property_orgId_lat_lng_idx" ON "Property"("orgId", "lat", "lng");

-- 6.2 PropertyPrice
CREATE TABLE IF NOT EXISTS "PropertyPrice" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "operation" "Operation" NOT NULL,
    "amount" DECIMAL(14,2),
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "period" "RentPeriod",
    "onRequest" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PropertyPrice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PropertyPrice_propertyId_operation_key" ON "PropertyPrice"("propertyId", "operation");
CREATE INDEX IF NOT EXISTS "PropertyPrice_orgId_operation_isActive_amount_idx" ON "PropertyPrice"("orgId", "operation", "isActive", "amount");
DO $$ BEGIN
    ALTER TABLE "PropertyPrice" ADD CONSTRAINT "PropertyPrice_propertyId_fkey"
        FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 6.3 MediaAsset
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "variants" JSONB;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "width" INTEGER;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "height" INTEGER;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT;

-- 6.3 Organization
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "customDomain" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "whatsapp" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "siteConfig" JSONB;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "demoExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_customDomain_key" ON "Organization"("customDomain");

-- 6.3 Client
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "documentType" "IdDocumentType";
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "documentNumber" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "whatsapp" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "searchCriteria" JSONB;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "consentAt" TIMESTAMP(3);
