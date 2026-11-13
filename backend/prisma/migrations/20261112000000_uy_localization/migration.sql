-- Uruguay localization (spec sections 6.3 and 7): new organizations and users start in Spanish,
-- America/Montevideo and USD. Only defaults change: existing rows keep their values.
DO $$ BEGIN
    CREATE TYPE "Currency" AS ENUM ('UYU', 'USD', 'UI', 'UR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "country" TEXT NOT NULL DEFAULT 'UY';
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'America/Montevideo';
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "defaultCurrency" "Currency" NOT NULL DEFAULT 'USD';
ALTER TABLE "Organization" ALTER COLUMN "preferredLanguage" SET DEFAULT 'es';
ALTER TABLE "User" ALTER COLUMN "preferredLanguage" SET DEFAULT 'es';
ALTER TABLE "User" ALTER COLUMN "timezone" SET DEFAULT 'America/Montevideo';
