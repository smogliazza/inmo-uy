// Instant filters of the public listings (spec 8.2). Everything runs in memory on the compact index, on the
// server for the first page and in the browser afterwards, with the state in the URL:
//   ?op=venta&tipo=casa,apartamento&zona=centro--salto&min=100000&max=300000&mon=usd&dorm=3&banos=2&m2=80
//    &am=parrillero,piscina&q=texto&orden=precio-asc&vista=mapa&area=-58.1,-31.5,-57.8,-31.2
// Prices are compared only within one currency: amounts in different currencies are never mixed.
// Past ~5.000 public listings the same query contract can move to the server (not needed yet).
import type { Currency } from "@/lib/catalogs";
import type { IndexItem, Operation } from "./types";

export type SortKey = "relevance" | "price-asc" | "price-desc" | "area";
export type ViewKey = "list" | "map" | "split";

export interface Filters {
  op: Operation | null;
  types: string[];
  zone: string | null;
  min: number | null;
  max: number | null;
  cur: Currency | null;
  beds: number | null;
  baths: number | null;
  area: number | null;
  am: string[];
  q: string;
  sort: SortKey;
  view: ViewKey;
  bbox: [number, number, number, number] | null; // west, south, east, north
}

export const EMPTY_FILTERS: Filters = {
  op: null, types: [], zone: null, min: null, max: null, cur: null, beds: null, baths: null, area: null,
  am: [], q: "", sort: "relevance", view: "list", bbox: null,
};

const OP_PARAM: Record<Operation, string> = { SALE: "venta", RENT: "alquiler", SEASONAL_RENT: "temporario" };
const PARAM_OP: Record<string, Operation> = { venta: "SALE", alquiler: "RENT", temporario: "SEASONAL_RENT" };
const SORT_PARAM: Record<SortKey, string> = { relevance: "", "price-asc": "precio-asc", "price-desc": "precio-desc", area: "superficie" };
const VIEW_PARAM: Record<ViewKey, string> = { list: "", map: "mapa", split: "dividida" };
const CURRENCIES: Currency[] = ["USD", "UYU", "UI", "UR"];

/** Accent- and case-insensitive text ("Daymán" = "dayman") */
export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const slugKey = (s: string) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Currency compared when filtering or sorting by price: the chosen one, else US$ for sale and $ for rent. */
export const priceCurrency = (f: Pick<Filters, "op" | "cur">, siteCurrency: Currency = "USD"): Currency =>
  f.cur ?? (f.op === "RENT" || f.op === "SEASONAL_RENT" ? "UYU" : siteCurrency);

type Params = { get(name: string): string | null } | Record<string, string | string[] | undefined>;
const read = (p: Params, k: string): string | null => {
  if (typeof (p as { get?: unknown }).get === "function") return (p as { get(n: string): string | null }).get(k);
  const v = (p as Record<string, string | string[] | undefined>)[k];
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
};
const list = (v: string | null) => (v ? v.split(",").map(s => s.trim()).filter(Boolean).slice(0, 30) : []);
const posNum = (v: string | null) => {
  if (!v) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function parseFilters(p: Params, preset: Partial<Filters> = {}): Filters {
  const op = PARAM_OP[read(p, "op") || ""] ?? preset.op ?? null;
  const cur = (read(p, "mon") || "").toUpperCase() as Currency;
  const bbox = list(read(p, "area")).map(Number);
  const sort = (Object.entries(SORT_PARAM).find(([, v]) => v && v === read(p, "orden"))?.[0] ?? "relevance") as SortKey;
  const view = (Object.entries(VIEW_PARAM).find(([, v]) => v && v === read(p, "vista"))?.[0] ?? "list") as ViewKey;
  return {
    ...EMPTY_FILTERS,
    op,
    types: list(read(p, "tipo")).map(t => t.toUpperCase().replace(/-/g, "_")),
    zone: read(p, "zona") || null,
    min: posNum(read(p, "min")),
    max: posNum(read(p, "max")),
    cur: CURRENCIES.includes(cur) ? cur : null,
    beds: posNum(read(p, "dorm")),
    baths: posNum(read(p, "banos")),
    area: posNum(read(p, "m2")),
    am: list(read(p, "am")),
    q: (read(p, "q") || "").slice(0, 80),
    sort, view,
    bbox: bbox.length === 4 && bbox.every(Number.isFinite) ? bbox as Filters["bbox"] : null,
  };
}

/** Query string for the filters (without the operation when the page already implies it, e.g. /venta). */
export function filtersToQuery(f: Filters, impliedOp: Operation | null = null): string {
  const q = new URLSearchParams();
  if (f.op && f.op !== impliedOp) q.set("op", OP_PARAM[f.op]);
  if (f.types.length) q.set("tipo", f.types.map(t => t.toLowerCase()).join(","));
  if (f.zone) q.set("zona", f.zone);
  if (f.min != null) q.set("min", String(f.min));
  if (f.max != null) q.set("max", String(f.max));
  if (f.cur && (f.min != null || f.max != null || f.sort.startsWith("price"))) q.set("mon", f.cur.toLowerCase());
  if (f.beds) q.set("dorm", String(f.beds));
  if (f.baths) q.set("banos", String(f.baths));
  if (f.area) q.set("m2", String(f.area));
  if (f.am.length) q.set("am", f.am.join(","));
  if (f.q.trim()) q.set("q", f.q.trim());
  if (SORT_PARAM[f.sort]) q.set("orden", SORT_PARAM[f.sort]);
  if (VIEW_PARAM[f.view]) q.set("vista", VIEW_PARAM[f.view]);
  if (f.bbox) q.set("area", f.bbox.map(n => n.toFixed(4)).join(","));
  const s = q.toString().replace(/%2C/g, ",");
  return s ? `?${s}` : "";
}

export const opToPath: Record<Operation, string | null> = { SALE: "/venta", RENT: "/alquiler", SEASONAL_RENT: null };

// ── Prepared index ───────────────────────────────────────────────────────────

export interface Prepared {
  item: IndexItem;
  hay: string;          // normalized searchable text
  zones: string[];      // city key and locality key
  area: number | null;  // m² (built, else land) for the minimum-area filter and sorting
}

export interface ZoneOption { key: string; label: string; city: string }

/** Zone keys: "salto" for the city, "centro--salto" for a locality in it. */
export function zoneKeys(x: Pick<IndexItem, "ci" | "lo" | "nb">): string[] {
  const city = slugKey(x.ci);
  const keys = [city];
  for (const l of [x.lo, x.nb]) if (l && slugKey(l) !== city) keys.push(`${slugKey(l)}--${city}`);
  return [...new Set(keys)];
}

export function prepare(items: IndexItem[], labels: { types: Record<string, string>; amenities: Record<string, string> }): Prepared[] {
  return items.map(item => ({
    item,
    hay: norm([
      item.ti, item.c, item.t && labels.types[item.t], item.ci, item.lo, item.nb, item.dp,
      ...(item.am || []).map(a => labels.amenities[a] || a),
    ].filter(Boolean).join(" ")),
    zones: zoneKeys(item),
    area: item.m2 ?? (item.la != null ? (item.lu === "HA" ? item.la * 10_000 : item.la) : null),
  }));
}

/** Every city and locality in the index, cities first (for the zone selector). */
export function zoneOptions(items: IndexItem[]): ZoneOption[] {
  const map = new Map<string, ZoneOption>();
  for (const x of items) {
    const city = slugKey(x.ci);
    if (!map.has(city)) map.set(city, { key: city, label: x.ci, city: x.ci });
    for (const l of [x.lo, x.nb]) {
      if (!l || slugKey(l) === city) continue;
      const k = `${slugKey(l)}--${city}`;
      if (!map.has(k)) map.set(k, { key: k, label: `${l}, ${x.ci}`, city: x.ci });
    }
  }
  return [...map.values()].sort((a, b) => a.city.localeCompare(b.city, "es") || (a.key.includes("--") ? 1 : 0) - (b.key.includes("--") ? 1 : 0) || a.label.localeCompare(b.label, "es"));
}

type Facet = "op" | "types" | "zone" | "beds" | "baths" | "am";

/** Price of the item that the filters compare: for the chosen operation (or any), in the compared currency. */
export function comparablePrice(x: IndexItem, f: Filters, siteCurrency: Currency = "USD"): number | null {
  const cur = priceCurrency(f, siteCurrency);
  for (const p of x.p) if ((!f.op || p[0] === f.op) && p[2] === cur && p[1] != null) return p[1];
  return null;
}

function matches(x: Prepared, f: Filters, terms: string[], skip: Facet | null, siteCurrency: Currency): boolean {
  const it = x.item;
  if (skip !== "op" && f.op && !it.p.some(p => p[0] === f.op)) return false;
  if (skip !== "types" && f.types.length && !(it.t && f.types.includes(it.t))) return false;
  if (skip !== "zone" && f.zone && !x.zones.includes(f.zone)) return false;
  if (skip !== "beds" && f.beds && !((it.bd ?? 0) >= f.beds)) return false;
  if (skip !== "baths" && f.baths && !((it.ba ?? 0) >= f.baths)) return false;
  if (skip !== "am" && f.am.length && !f.am.every(a => it.am?.includes(a))) return false;
  if (f.area && !((x.area ?? 0) >= f.area)) return false;
  if (f.min != null || f.max != null) {
    const price = comparablePrice(it, f, siteCurrency);
    if (price == null) return false;
    if (f.min != null && price < f.min) return false;
    if (f.max != null && price > f.max) return false;
  }
  if (f.bbox) {
    if (!it.ll) return false;
    const [w, s, e, n] = f.bbox;
    const [lat, lng] = it.ll;
    if (lat < s || lat > n || lng < w || lng > e) return false;
  }
  for (const t of terms) if (!x.hay.includes(t)) return false;
  return true;
}

const termsOf = (q: string) => norm(q).split(/\s+/).filter(Boolean);

export function applyFilters(all: Prepared[], f: Filters, siteCurrency: Currency = "USD"): Prepared[] {
  const terms = termsOf(f.q);
  const out = all.filter(x => matches(x, f, terms, null, siteCurrency));
  if (f.sort === "relevance") return out;
  const val = (x: Prepared) => (f.sort === "area" ? x.area : comparablePrice(x.item, f, siteCurrency));
  const dir = f.sort === "price-asc" ? 1 : -1;
  // Listings without a comparable value ("Consultar", another currency) go last in every order
  return out.map((x, i) => ({ x, i, v: val(x) })).sort((a, b) =>
    a.v == null && b.v == null ? a.i - b.i : a.v == null ? 1 : b.v == null ? -1 : (a.v - b.v) * dir || a.i - b.i,
  ).map(r => r.x);
}

export interface FacetCounts {
  op: Record<string, number>;
  types: Record<string, number>;
  zone: Record<string, number>;
  beds: Record<string, number>;
  baths: Record<string, number>;
  am: Record<string, number>;
}

/** Live counters per option ("Casas (108)"): each facet counts with every other filter applied. */
export function facetCounts(all: Prepared[], f: Filters, siteCurrency: Currency = "USD"): FacetCounts {
  const terms = termsOf(f.q);
  const c: FacetCounts = { op: {}, types: {}, zone: {}, beds: {}, baths: {}, am: {} };
  const inc = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
  for (const x of all) {
    const it = x.item;
    if (matches(x, f, terms, "op", siteCurrency)) { inc(c.op, "ALL"); for (const op of new Set(it.p.map(p => p[0]))) inc(c.op, op); }
    if (it.t && matches(x, f, terms, "types", siteCurrency)) inc(c.types, it.t);
    if (matches(x, f, terms, "zone", siteCurrency)) for (const z of x.zones) inc(c.zone, z);
    if (matches(x, f, terms, "beds", siteCurrency)) for (let n = 1; n <= Math.min(5, it.bd ?? 0); n++) inc(c.beds, String(n));
    if (matches(x, f, terms, "baths", siteCurrency)) for (let n = 1; n <= Math.min(4, it.ba ?? 0); n++) inc(c.baths, String(n));
    if (it.am && matches(x, f, terms, "am", siteCurrency)) for (const a of it.am) inc(c.am, a);
  }
  return c;
}

export const activeFilterCount = (f: Filters) =>
  [f.types.length, f.zone, f.min != null || f.max != null, f.beds, f.baths, f.area, f.am.length, f.q.trim(), f.bbox].filter(Boolean).length;
