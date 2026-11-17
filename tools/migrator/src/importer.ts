// Writes a crawl into the platform's database with the backend's own helpers (spec 11.2 / 11.3):
//  - upsert per (orgId, externalSource='inmobiliariaya', externalId=idprop): running twice updates, never duplicates;
//  - listings that disappeared from the source become WITHDRAWN (nothing is deleted);
//  - photos downloaded in order, stored (R2 or the database fallback) with WebP variants and their sourceUrl;
//  - coordinates of the listing page (EXACT), else Nominatim on the address (APPROX), else the city centre (APPROX);
//  - demo mode: a brokerage with isDemo=true that expires in 30 days; migration mode: an existing brokerage,
//    with who authorized it recorded in the audit log.
import { randomUUID } from "node:crypto";
import { prisma, Prisma } from "../../../backend/src/lib/db";
import { savePrices, type PriceInput } from "../../../backend/src/lib/listing";
import { storeUploadedFile } from "../../../backend/src/lib/storage";
import { createWebpVariants } from "../../../backend/src/lib/images";
import { geocode } from "../../../backend/src/lib/geocode";
import { normalizePhoneUY, matchPlaceName } from "../../../backend/src/lib/uy";
import { parseSiteConfig } from "../../../backend/src/lib/siteConfig";
import { getOrgModules } from "../../../backend/src/lib/modules";
import type { CrawlResult } from "./crawl";
import type { Draft } from "./rules";
import type { Fetcher } from "./fetcher";

export const SOURCE = "inmobiliariaya";
const DEMO_DAYS = 30;

export interface ImportOptions {
  mode: "demo" | "migration";
  orgId?: string;                 // migration
  actorEmail?: string;            // migration: a SUPERADMIN
  authorizedBy?: string;          // migration: "name, date"
  agentEmail?: string;            // who the listings belong to (default: the brokerage's first admin)
  apiUrl: string;                 // public base of /api/uploads/public/:id
  maxPhotos?: number;
  geocode?: boolean;
  log: (m: string) => void;
}

export interface ImportSummary { orgId: string; slug: string | null; created: number; updated: number; withdrawn: number; photos: number; geocoded: number; warnings: string[] }

const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

async function audit(orgId: string, userId: string, action: string, entityId: string | null, after: unknown) {
  await prisma.auditLog.create({ data: { orgId, userId, action, entity: "Organization", entityId, after: JSON.stringify(after), userAgent: "inmo-uy-migrator" } });
}

/** Demo brokerage for a source host: reused on every run (the same demo is refreshed, never duplicated). */
async function demoOrganization(r: CrawlResult): Promise<{ orgId: string; agentId: string }> {
  const slug = `demo-${slugify(r.host.replace(/\.(com|net|org)?\.?uy$|\.com$/, ""))}`.slice(0, 48);
  const existing = await prisma.organization.findUnique({ where: { slug }, select: { id: true, isDemo: true } });
  if (existing && !existing.isDemo) throw new Error(`The slug ${slug} belongs to a real brokerage; demo mode will not touch it`);
  const orgId = existing?.id ?? randomUUID();
  if (!existing) {
    await prisma.organization.create({
      data: {
        id: orgId, slug, name: r.org.name || r.host, isDemo: true,
        demoExpiresAt: new Date(Date.now() + DEMO_DAYS * 24 * 3600 * 1000),
      },
    });
  }
  // The listings need an agent: a user that cannot sign in (no password), only to own the demo's data
  const email = `${slug}@demo.invalid`;
  const agent = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: r.org.name || r.host, role: "FIRMADMIN", orgId, password: null },
    select: { id: true },
  });
  return { orgId, agentId: agent.id };
}

/** Brokerage data from the source: contact, logo and site configuration (only fields still empty in migration mode). */
async function applyOrgInfo(orgId: string, r: CrawlResult, overwrite: boolean, f: Fetcher, apiUrl: string) {
  const o = r.org;
  const cur = await prisma.organization.findUnique({ where: { id: orgId }, select: { phone: true, whatsapp: true, address: true, logoUrl: true, siteConfig: true, website: true } });
  // The logo is copied too (after a migration the source site goes away); once copied it is not copied again
  let logoUrl: string | null = null;
  const haveLogo = !!cur?.logoUrl && (!overwrite || cur.logoUrl.startsWith(`${apiUrl}/api/uploads/public/`));
  if (o.logoUrl && !haveLogo) {
    try {
      const file = await f.bytes(o.logoUrl, `${r.origin}/`);
      if (file && /^image\//.test(file.mimeType)) {
        const stored = await storeUploadedFile({ orgId, visibility: "PUBLIC", filename: o.logoUrl.split("/").pop() || "logo.png", mimeType: file.mimeType, buffer: file.buffer });
        logoUrl = `${apiUrl}/api/uploads/public/${stored.id}`;
      }
    } catch { /* keep going without the logo */ }
  }
  const keep = <T>(now: T | null | undefined, next: T | null) => (overwrite ? next ?? now ?? null : now ?? next);
  const phone = o.phones.map(p => normalizePhoneUY(p)).find(p => p && p !== normalizePhoneUY(o.whatsapp ?? "")) ?? null;
  const cfg = (cur?.siteConfig && typeof cur.siteConfig === "object" ? cur.siteConfig : {}) as Record<string, unknown>;
  const parsed = parseSiteConfig({
    ...cfg,
    email: overwrite ? o.email ?? cfg.email : cfg.email ?? o.email,
    hours: overwrite ? o.hours ?? cfg.hours : cfg.hours ?? o.hours,
    social: { ...o.social, ...(overwrite ? {} : (cfg.social as object | undefined) ?? {}) },
  }, true);
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      phone: keep(cur?.phone, phone),
      whatsapp: keep(cur?.whatsapp, o.whatsapp ? normalizePhoneUY(o.whatsapp) : null),
      address: keep(cur?.address, o.address),
      logoUrl: keep(cur?.logoUrl, logoUrl),
      website: keep(cur?.website, r.origin),
      ...(parsed.ok ? { siteConfig: parsed.config as unknown as Prisma.InputJsonValue } : {}),
    },
  });
}

const cityCenters = new Map<string, { lat: number; lng: number } | null>();

async function locate(d: Draft, log: (m: string) => void): Promise<{ lat: number; lng: number; precision: "EXACT" | "APPROX" } | null> {
  if (d.lat != null && d.lng != null) return { lat: d.lat, lng: d.lng, precision: "EXACT" };
  const tail = [d.city, d.state && d.state !== d.city ? d.state : null, "Uruguay"].filter(Boolean).join(", ");
  try {
    if (d.address) {
      const hit = (await geocode(`${d.address}, ${d.locality ? `${d.locality}, ` : ""}${tail}`, { limit: 1 }))[0];
      if (hit) return { lat: hit.lat, lng: hit.lng, precision: "APPROX" };
    }
    const key = tail.toLowerCase();
    if (!cityCenters.has(key)) cityCenters.set(key, (await geocode(tail, { limit: 1 }))[0] ?? null);
    const c = cityCenters.get(key);
    if (c) { d.warnings.push("Ubicación aproximada: centro de la ciudad"); return { lat: c.lat, lng: c.lng, precision: "APPROX" }; }
  } catch (err) {
    log(`  geocoding failed for ${d.externalId}: ${err instanceof Error ? err.message : err}`);
  }
  d.warnings.push("Sin ubicación en el mapa");
  return null;
}

export async function importCrawl(r: CrawlResult, f: Fetcher, o: ImportOptions): Promise<ImportSummary> {
  let orgId: string, agentId: string, actorId: string;
  if (o.mode === "demo") {
    ({ orgId, agentId } = await demoOrganization(r));
    actorId = agentId;
    await applyOrgInfo(orgId, r, true, f, o.apiUrl);
  } else {
    if (!o.orgId || !o.authorizedBy || !o.actorEmail) throw new Error("Migration mode needs --org, --authorized-by and --as (a SUPERADMIN)");
    const actor = await prisma.user.findUnique({ where: { email: o.actorEmail.toLowerCase() }, select: { id: true, role: true, orgId: true } });
    if (actor?.role !== "SUPERADMIN") throw new Error(`${o.actorEmail} is not a SUPERADMIN: migration mode is only for them`);
    const org = await prisma.organization.findUnique({ where: { id: o.orgId }, select: { id: true, isDemo: true } });
    if (!org) throw new Error(`Organization ${o.orgId} not found`);
    // The "Migrador inmobiliariaya" module (SUPERADMIN only) has to be on for that brokerage
    if (!(await getOrgModules(org.id)).migrator.enabled) throw new Error("The migrator module is off for that brokerage: turn it on in Settings > Modules (SUPERADMIN)");
    orgId = org.id;
    actorId = actor.id;
    const agent = o.agentEmail
      ? await prisma.user.findFirst({ where: { email: o.agentEmail.toLowerCase(), orgId }, select: { id: true } })
      : await prisma.user.findFirst({ where: { orgId, role: { in: ["FIRMADMIN", "MANAGER"] } }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!agent) throw new Error("No agent to own the listings in that brokerage (use --agent <email>)");
    agentId = agent.id;
    // Who authorized the migration of this brokerage's data, before writing anything (spec 11.3)
    await prisma.auditLog.create({ data: {
      orgId, userId: actorId, action: "MIGRATION_AUTHORIZED", entity: "Organization", entityId: orgId,
      after: JSON.stringify({ source: r.origin, authorizedBy: o.authorizedBy, announced: r.account.total }), userAgent: "inmo-uy-migrator",
    } });
    await applyOrgInfo(orgId, r, false, f, o.apiUrl);
  }

  const summary: ImportSummary = { orgId, slug: null, created: 0, updated: 0, withdrawn: 0, photos: 0, geocoded: 0, warnings: [] };
  const existingCities = new Set((await prisma.property.findMany({ where: { orgId }, distinct: ["city"], select: { city: true } })).map(p => p.city));
  const seenIds: string[] = [];
  let n = 0;

  for (const d of r.drafts) {
    n++;
    seenIds.push(d.externalId);
    const where = { orgId_externalSource_externalId: { orgId, externalSource: SOURCE, externalId: d.externalId } };
    const prev = await prisma.property.findUnique({ where, select: { id: true, code: true, lat: true, lng: true, geoPrecision: true } });

    // Code: unique per brokerage; on a clash with a listing of another origin, fall back to the idprop
    let code = prev?.code ?? d.code;
    if (!prev) {
      const clash = await prisma.property.findFirst({ where: { orgId, code }, select: { id: true } });
      if (clash) { d.warnings.push(`El código ${code} ya existe en la inmobiliaria: se usa ${d.externalId}`); code = d.externalId; }
      if (await prisma.property.findFirst({ where: { orgId, code }, select: { id: true } })) code = `IY-${d.externalId}`;
    }
    const city = matchPlaceName(d.city, existingCities) ?? d.city;
    existingCities.add(city);
    const locality = d.locality ? matchPlaceName(d.locality, []) : null;

    // Location: keep a pin someone already corrected by hand; geocode only what has none
    let loc: { lat: number; lng: number; precision: "EXACT" | "APPROX" } | null = null;
    if (prev?.lat != null && prev.lng != null && d.lat == null) loc = { lat: prev.lat, lng: prev.lng, precision: prev.geoPrecision === "EXACT" ? "EXACT" : "APPROX" };
    else if (o.geocode !== false) { loc = await locate(d, o.log); if (loc && d.lat == null) summary.geocoded++; }
    else if (d.lat != null) loc = { lat: d.lat, lng: d.lng!, precision: "EXACT" };

    const data = {
      title: d.title?.slice(0, 120) ?? null,
      propertyType: d.propertyType,
      address: d.address ?? locality ?? city,
      city, state: d.state, locality,
      beds: d.beds, baths: d.baths, builtAreaM2: d.builtAreaM2,
      landArea: d.landArea, landAreaUnit: d.landAreaUnit, garageSpaces: d.garageSpaces,
      amenities: d.amenities, furnished: d.furnished,
      description: d.description, featured: d.featured,
      status: "ACTIVE" as const, isPublic: true,
      externalUrl: d.externalUrl, importedAt: new Date(),
      ...(loc ? { lat: loc.lat, lng: loc.lng, geoPrecision: loc.precision } : {}),
    };
    const prices: PriceInput[] = d.prices.map(p => ({
      operation: p.operation, amount: p.amount == null ? null : new Prisma.Decimal(p.amount), currency: p.currency,
      period: p.period, onRequest: p.onRequest, isActive: true,
    }));

    const propertyId = await prisma.$transaction(async tx => {
      const p = prev
        ? await tx.property.update({ where: { id: prev.id }, data, select: { id: true } })
        : await tx.property.create({ data: { ...data, code, orgId, agentId, externalSource: SOURCE, externalId: d.externalId }, select: { id: true } });
      await savePrices(tx, p.id, orgId, prices);
      return p.id;
    });
    if (prev) summary.updated++; else summary.created++;

    // Photos, in order; already imported ones (same sourceUrl) are skipped
    const have = new Set((await prisma.mediaAsset.findMany({ where: { propertyId }, select: { sourceUrl: true } })).map(m => m.sourceUrl));
    let order = await prisma.mediaAsset.count({ where: { propertyId } });
    for (const src of d.photos.slice(0, o.maxPhotos ?? 40)) {
      if (have.has(src)) continue;
      try {
        const file = await f.bytes(src, `${r.origin}/`);
        if (!file || !/^image\//.test(file.mimeType)) { d.warnings.push(`Foto no disponible: ${src}`); continue; }
        const name = src.split("/").pop() || "foto.jpg";
        const stored = await storeUploadedFile({ orgId, visibility: "PUBLIC", filename: name, mimeType: file.mimeType, buffer: file.buffer });
        const url = (id: string) => `${o.apiUrl}/api/uploads/public/${id}`;
        const made = await createWebpVariants(stored.id, orgId, url);
        await prisma.mediaAsset.create({ data: {
          propertyId, orgId, type: "image", url: url(stored.id), storageKey: stored.id, sizeBytes: stored.sizeBytes, mimeType: stored.mimeType,
          sortOrder: order++, sourceUrl: src,
          ...(made ? { variants: made.variants as unknown as Prisma.InputJsonValue, width: made.width, height: made.height } : {}),
        } });
        summary.photos++;
      } catch (err) {
        d.warnings.push(`Foto no importada (${err instanceof Error ? err.message : err}): ${src}`);
      }
    }
    if (n % 10 === 0 || n === r.drafts.length) o.log(`  ${n}/${r.drafts.length} listings, ${summary.photos} photos`);
  }

  // Gone from the source → WITHDRAWN (never deleted). Only after a complete crawl: a partial one (--limit, a page
  // that did not answer) would otherwise withdraw everything it did not see.
  if (r.drafts.length >= r.account.total) {
    const gone = await prisma.property.updateMany({
      where: { orgId, externalSource: SOURCE, externalId: { notIn: seenIds }, status: { in: ["ACTIVE", "COMING_SOON", "IN_CONTRACT", "RESERVED"] } },
      data: { status: "WITHDRAWN" },
    });
    summary.withdrawn = gone.count;
  } else {
    o.log(`  partial crawl (${r.drafts.length} of ${r.account.total}): listings missing from it are left as they are`);
  }
  summary.warnings = r.drafts.flatMap(d => d.warnings.map(w => `${d.externalId}: ${w}`));
  summary.slug = (await prisma.organization.findUnique({ where: { id: orgId }, select: { slug: true } }))?.slug ?? null;
  await audit(orgId, actorId, o.mode === "demo" ? "DEMO_IMPORTED" : "MIGRATION_IMPORTED", orgId,
    { source: r.origin, created: summary.created, updated: summary.updated, withdrawn: summary.withdrawn, photos: summary.photos });
  return summary;
}
