// Final report (spec 11.3): totals per type, operation and city, compared with the counters of the source's own
// menus, plus every warning. Written to out/{host}.json and out/{host}-warnings.csv.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CrawlResult } from "./crawl";

export interface Comparison { name: string; source: number | null; imported: number; ok: boolean }

export interface Report {
  host: string;
  generatedAt: string;
  announced: number;
  found: number;
  totalOk: boolean;
  byType: Comparison[];
  byOperation: Comparison[];
  byCity: Comparison[];
  warnings: number;
  withCoordinates: number;
  withPhotos: number;
}

const OP_NAME: Record<string, string> = { SALE: "Venta", RENT: "Alquiler", SEASONAL_RENT: "Alquiler temporario" };
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function compare(source: Record<string, number>, imported: Map<string, number>): Comparison[] {
  const names = new Map<string, string>();
  for (const k of [...Object.keys(source), ...imported.keys()]) if (!names.has(norm(k))) names.set(norm(k), k);
  return [...names.entries()].map(([key, name]) => {
    const src = Object.entries(source).find(([k]) => norm(k) === key)?.[1] ?? null;
    const imp = [...imported.entries()].filter(([k]) => norm(k) === key).reduce((a, [, n]) => a + n, 0);
    return { name, source: src, imported: imp, ok: src === imp };
  }).sort((a, b) => (b.source ?? b.imported) - (a.source ?? a.imported));
}

export function buildReport(r: CrawlResult): Report {
  const types = new Map<string, number>(), ops = new Map<string, number>(), cities = new Map<string, number>();
  const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const card of r.cards) {
    // Counted with the source's own names, as its menus do
    const label = card.label ?? "";
    const m = /^(.+?) en (.+?) en (.+)$/.exec(label);
    if (m) inc(types, m[1]);
  }
  for (const d of r.drafts) {
    for (const p of d.prices) inc(ops, OP_NAME[p.operation]);
    inc(cities, d.city);
  }
  return {
    host: r.host,
    generatedAt: new Date().toISOString(),
    announced: r.account.total,
    found: r.drafts.length,
    totalOk: r.account.total === r.drafts.length,
    byType: compare(r.org.counts.types, types),
    byOperation: compare(r.org.counts.operations, ops),
    byCity: compare(r.org.counts.cities, cities),
    warnings: r.drafts.reduce((a, d) => a + d.warnings.length, 0),
    withCoordinates: r.drafts.filter(d => d.lat != null).length,
    withPhotos: r.drafts.filter(d => d.photos.length).length,
  };
}

const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function writeOutputs(outDir: string, r: CrawlResult, report: Report): { json: string; csv: string } {
  mkdirSync(outDir, { recursive: true });
  const json = join(outDir, `${r.host}.json`);
  const warnings = join(outDir, `${r.host}-warnings.csv`);
  writeFileSync(json, JSON.stringify({ report, organization: r.org, listings: r.drafts }, null, 2));
  const rows = [["idprop", "codigo", "titulo", "advertencia", "url"].map(csv).join(",")];
  for (const d of r.drafts) for (const w of d.warnings) rows.push([d.externalId, d.code, d.title, w, d.externalUrl].map(csv).join(","));
  writeFileSync(warnings, "﻿" + rows.join("\n") + "\n"); // BOM: Excel opens it with the accents right
  return { json, csv: warnings };
}

export function printReport(rep: Report, log: (m: string) => void) {
  const mark = (ok: boolean) => (ok ? "✓" : "✗");
  log(`\n${mark(rep.totalOk)} Total: ${rep.found} encontradas de ${rep.announced} anunciadas`);
  for (const [title, rows] of [["Tipo", rep.byType], ["Operación", rep.byOperation], ["Ciudad", rep.byCity]] as const) {
    log(`\n${title}:`);
    for (const c of rows) log(`  ${mark(c.ok)} ${c.name.padEnd(24)} origen ${String(c.source ?? "—").padStart(4)}  importadas ${String(c.imported).padStart(4)}`);
  }
  log(`\nCon coordenadas de la ficha: ${rep.withCoordinates} · con fotos: ${rep.withPhotos} · advertencias: ${rep.warnings}`);
}
