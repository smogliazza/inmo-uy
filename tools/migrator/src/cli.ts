// npm run migrator -- --url https://www.castroymeirelles.com.uy --mode demo [--dry-run]
// npm run migrator -- --url … --mode migration --org <id> --authorized-by "Nombre, 2026-11-20" --as admin@plataforma.uy
//
// Options:
//   --dry-run            writes out/{host}.json and out/{host}-warnings.csv, never touches the database
//   --limit N            only the first N listings (trial runs)
//   --no-details         cards only, without each listing page (fast check of totals)
//   --offline            only what is already in .cache/ (no request to the source)
//   --max-photos N       photos per listing (default 40)
//   --no-geocode         do not call Nominatim for listings without coordinates
//   --agent <email>      migration: user who owns the listings (default: the brokerage's first admin)
// Environment: MIGRATOR_USER_AGENT (with a contact, required to fetch), DATABASE_URL, MIGRATOR_PUBLIC_API_URL
// (public base of the photos, e.g. https://app.plataforma.uy), and the backend's R2_* / GEOCODER_USER_AGENT.
import { join } from "node:path";
import { Fetcher } from "./fetcher";
import { crawl } from "./crawl";
import { buildReport, printReport, writeOutputs } from "./report";

function args(argv: string[]) {
  const a: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { a[k.slice(2)] = next; i++; } else a[k.slice(2)] = true;
  }
  return a;
}

async function main() {
  const a = args(process.argv.slice(2));
  const log = (m: string) => console.log(m);
  const url = typeof a.url === "string" ? a.url : "";
  const mode = a.mode === "migration" ? "migration" : a.mode === "demo" ? "demo" : null;
  if (!url || !mode) {
    console.error("Usage: npm run migrator -- --url <site> --mode demo|migration [--dry-run] (see src/cli.ts)");
    process.exit(2);
  }
  const root = join(__dirname, "..");
  const userAgent = process.env.MIGRATOR_USER_AGENT || "";
  if (!userAgent && !a.offline) {
    console.error('Set MIGRATOR_USER_AGENT with a contact, e.g. "inmo-uy-migrator/1.0 (+https://plataforma.uy; ops@plataforma.uy)"');
    process.exit(2);
  }
  const fetcher = new Fetcher({ userAgent: userAgent || "offline (+cache)", cacheDir: join(root, ".cache"), offline: !!a.offline, log });
  const started = Date.now();
  const result = await crawl(url, fetcher, { details: !a["no-details"], limit: a.limit ? Number(a.limit) : undefined, log });
  const report = buildReport(result);

  if (!a["dry-run"]) {
    const apiUrl = (process.env.MIGRATOR_PUBLIC_API_URL || "").replace(/\/$/, "");
    if (!apiUrl) { console.error("Set MIGRATOR_PUBLIC_API_URL (public base of the API, for the photo URLs)"); process.exit(2); }
    const { importCrawl } = await import("./importer"); // the database is only opened when importing
    const s = await importCrawl(result, fetcher, {
      mode, apiUrl, log,
      orgId: typeof a.org === "string" ? a.org : undefined,
      authorizedBy: typeof a["authorized-by"] === "string" ? a["authorized-by"] : undefined,
      actorEmail: typeof a.as === "string" ? a.as : undefined,
      agentEmail: typeof a.agent === "string" ? a.agent : undefined,
      maxPhotos: a["max-photos"] ? Number(a["max-photos"]) : undefined,
      geocode: !a["no-geocode"],
    });
    log(`\nImported into ${s.slug ?? s.orgId}: ${s.created} new, ${s.updated} updated, ${s.withdrawn} withdrawn, ${s.photos} photos, ${s.geocoded} geocoded`);
  }
  const out = writeOutputs(join(root, "out"), result, report);
  printReport(report, log);
  log(`\n${fetcher.requests} requests to the source, ${fetcher.cacheHits} from the cache, ${Math.round((Date.now() - started) / 1000)} s`);
  log(`Report: ${out.json}\nWarnings: ${out.csv}`);
  if (!a["dry-run"]) {
    const { prisma } = await import("../../../backend/src/lib/db");
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
