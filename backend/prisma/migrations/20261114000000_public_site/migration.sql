-- Public site per domain (spec section 8). Additive only; every statement can run twice.

ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "title" TEXT;

CREATE TABLE IF NOT EXISTS "SiteEvent" (
    "id"         TEXT NOT NULL,
    "orgId"      TEXT NOT NULL,
    "propertyId" TEXT,
    "type"       TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SiteEvent_orgId_createdAt_idx" ON "SiteEvent"("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "SiteEvent_propertyId_idx" ON "SiteEvent"("propertyId");
