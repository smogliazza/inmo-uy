// Parsing rules of spec 11.2: Uruguayan numbers, prices per operation, source type names → UY catalog,
// location labels and features. Every doubtful case becomes a warning in the report, never a guess.
import type { SourceCard, SourceDetail } from "./parse";

export type Operation = "SALE" | "RENT" | "SEASONAL_RENT";
export type Currency = "USD" | "UYU" | "UI" | "UR";
export type Period = "MONTH" | "WEEK" | "NIGHT" | "SEASON";

export interface PriceDraft { operation: Operation; amount: number | null; currency: Currency; period: Period | null; onRequest: boolean }

export interface Draft {
  externalId: string;
  externalUrl: string;
  code: string;
  title: string | null;
  propertyType: string;
  featured: boolean;
  prices: PriceDraft[];
  city: string;
  state: string | null;      // department
  locality: string | null;
  address: string | null;
  beds: number | null;
  baths: number | null;
  builtAreaM2: number | null;
  landArea: number | null;
  landAreaUnit: "M2" | "HA" | null;
  garageSpaces: number | null;
  amenities: string[];
  furnished: boolean;
  description: string | null;
  photos: string[];
  lat: number | null;
  lng: number | null;
  geoPrecision: "EXACT" | "APPROX";
  warnings: string[];
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** "4.230" → 4230 · "14,39" → 14.39 · "450.000" → 450000 · "1.234,5" → 1234.5 */
export function parseNumberUY(raw: string): number | null {
  const s = raw.replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return null;
  let t = s;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const OPERATIONS: [RegExp, Operation][] = [
  [/^alquiler\s+(temporario|temporal|de\s+temporada|por\s+temporada)/i, "SEASONAL_RENT"],
  [/^alquiler/i, "RENT"],
  [/^venta/i, "SALE"],
];

/** "Venta US$ 450.000" · "Alquiler $ 80.000 /mes" · "Venta Consulte Personalmente" · "Venta" */
export function parsePrice(text: string, warn: (w: string) => void): PriceDraft | null {
  const t = text.replace(/\s+/g, " ").trim();
  const op = OPERATIONS.find(([re]) => re.test(t))?.[1];
  if (!op) { if (t) warn(`Precio sin operación reconocible: «${t}»`); return null; }
  const rest = t.replace(/^(venta|alquiler(\s+(temporario|temporal|de temporada|por temporada))?)\s*/i, "");
  const cur: Currency | null = /U\$S|US\$|USD|U\$D/i.test(rest) ? "USD" : /\bUI\b/.test(rest) ? "UI" : /\bUR\b/.test(rest) ? "UR" : /\$/.test(rest) ? "UYU" : null;
  const amount = parseNumberUY(rest.replace(/\/.*$/, ""));
  const period: Period | null = op === "SALE" ? null
    : /\/\s*(semana)/i.test(rest) ? "WEEK"
    : /\/\s*(noche|d[ií]a)/i.test(rest) ? "NIGHT"
    : /\/\s*(temporada|mes(es)? de temporada)/i.test(rest) ? "SEASON"
    : op === "SEASONAL_RENT" && !/\/\s*mes/i.test(rest) ? "SEASON" : "MONTH";
  const currency: Currency = cur ?? (op === "SALE" ? "USD" : "UYU");
  if (amount == null || /consult/i.test(rest)) return { operation: op, amount: null, currency, period, onRequest: true };
  if (amount <= 10) {
    warn(`Monto simbólico (${t}): se publica como «Consultar»`);
    return { operation: op, amount: null, currency, period, onRequest: true };
  }
  if (!cur) warn(`Precio sin moneda (${t}): se asume ${currency}`);
  return { operation: op, amount, currency, period, onRequest: false };
}

// Source type names (plural, as in the menus) → UY catalog (backend/src/lib/catalogs.ts)
const TYPES: Record<string, string> = {
  casa: "CASA", casas: "CASA", apartamento: "APARTAMENTO", apartamentos: "APARTAMENTO",
  terreno: "TERRENO", terrenos: "TERRENO", "campos y chacras": "CAMPO_CHACRA", campo: "CAMPO_CHACRA", campos: "CAMPO_CHACRA",
  chacra: "CAMPO_CHACRA", chacras: "CAMPO_CHACRA", "local comercial": "LOCAL_COMERCIAL", "locales comerciales": "LOCAL_COMERCIAL",
  locales: "LOCAL_COMERCIAL", oficina: "OFICINA", oficinas: "OFICINA", galpon: "GALPON", galpones: "GALPON",
  hotel: "HOTEL", hoteles: "HOTEL", cochera: "COCHERA", cocheras: "COCHERA", garaje: "COCHERA", garajes: "COCHERA",
  edificio: "EDIFICIO", edificios: "EDIFICIO",
};

export function mapType(name: string | null | undefined, warn: (w: string) => void): string {
  const t = TYPES[norm(name || "")];
  if (t) return t;
  warn(`Tipo sin equivalente en el catálogo: «${name || "(vacío)"}» → Otro`);
  return "OTRO";
}

// Cities the source uses that are not departments, with their department (only the ones seen in practice;
// anything else keeps the department empty and gets a warning)
const DEPARTMENTS = ["Artigas", "Canelones", "Cerro Largo", "Colonia", "Durazno", "Flores", "Florida", "Lavalleja", "Maldonado",
  "Montevideo", "Paysandú", "Río Negro", "Rivera", "Rocha", "Salto", "San José", "Soriano", "Tacuarembó", "Treinta y Tres"];
const CITY_DEPARTMENT: Record<string, string> = {
  "termas del dayman": "Salto", belen: "Salto", constitucion: "Salto", "salto grande": "Salto",
  "la floresta": "Canelones", "punta del este": "Maldonado", "la barra": "Maldonado", piriapolis: "Maldonado",
};
export const departmentOf = (city: string) => DEPARTMENTS.find(d => norm(d) === norm(city)) ?? CITY_DEPARTMENT[norm(city)] ?? null;

export interface Label { typeName: string | null; operation: string | null; locality: string | null; city: string | null; department: string | null }

/**
 * "Casas en Venta en Centro, Salto, Salto" → type, operation, locality, city, department.
 * Two parts are "locality, city" unless the first is one of the source's cities ("Salto, Salto").
 */
export function parseLabel(label: string | null, knownCities: string[]): Label {
  const empty: Label = { typeName: null, operation: null, locality: null, city: null, department: null };
  if (!label) return empty;
  const OP = "(?:Venta|Alquiler(?: (?:Temporario|Temporal|de Temporada|por Temporada))?)";
  const m = new RegExp(`^(.+?) en (${OP}(?:\\s*(?:,|y)\\s*${OP})*) en (.+)$`, "i").exec(label.trim());
  if (!m) return empty;
  const parts = m[3].split(",").map(p => p.trim()).filter(Boolean);
  const isCity = (p: string) => knownCities.some(c => norm(c) === norm(p));
  let locality: string | null = null, city: string | null = null, department: string | null = null;
  if (parts.length >= 3) [locality, city, department] = [parts[0], parts[1], parts[2]];
  else if (parts.length === 2) {
    if (norm(parts[0]) === norm(parts[1]) || isCity(parts[0])) [city, department] = [parts[0], parts[1]];
    else [locality, city] = [parts[0], parts[1]];
  } else if (parts.length === 1) city = parts[0];
  if (city && !department) department = departmentOf(city);
  if (locality && city && norm(locality) === norm(city)) locality = null;
  return { typeName: m[1], operation: m[2], locality, city, department };
}

const AMENITY_WORDS: Record<string, string> = {
  patio: "patio", parrillero: "parrillero", barbacoa: "barbacoa", jardin: "jardin", terraza: "terraza", balcon: "balcon",
  piscina: "piscina", ascensor: "ascensor", portero: "portero", calefaccion: "calefaccion", "aire acondicionado": "aire_acondicionado",
  amoblado: "amoblado", amueblado: "amoblado", "acepta mascotas": "apto_mascotas", "vista al mar": "vista_al_mar",
  seguridad: "seguridad", gimnasio: "gimnasio", lavadero: "lavadero", deposito: "deposito",
};

export interface Features { beds: number | null; baths: number | null; builtAreaM2: number | null; landArea: number | null; landAreaUnit: "M2" | "HA" | null; garageSpaces: number | null; amenities: string[] }

/** "2 Dormitorio/s", "1 BAÑO", "130 m2 const.", "4.230 m2 total", "14,39 hectáreas total", "1 AUTOS", "PATIO" */
export function parseFeatures(items: string[]): Features {
  const f: Features = { beds: null, baths: null, builtAreaM2: null, landArea: null, landAreaUnit: null, garageSpaces: null, amenities: [] };
  for (const raw of items) {
    const t = norm(raw);
    const n = parseNumberUY(raw.match(/^[\d.,\s]+/)?.[0] ?? raw);
    if (/dormitorio/.test(t)) f.beds = n;
    else if (/bano/.test(t)) f.baths = n;
    else if (/auto|garaje|cochera/.test(t) && n != null) f.garageSpaces = Math.round(n);
    else if (/hect/.test(t)) { f.landArea = n; f.landAreaUnit = "HA"; }
    else if (/m2/.test(t) && /(const|edific)/.test(t)) f.builtAreaM2 = n;
    else if (/m2/.test(t) && /(total|terreno)/.test(t)) { if (f.landAreaUnit !== "HA") { f.landArea = n; f.landAreaUnit = "M2"; } }
    else if (AMENITY_WORDS[t] && !f.amenities.includes(AMENITY_WORDS[t])) f.amenities.push(AMENITY_WORDS[t]);
  }
  return f;
}

/**
 * One listing ready to import: card (always) + detail page (when fetched).
 * `usedCodes` holds the codes already given in this brokerage, so a repeated or free-text code falls back to the idprop.
 */
export function toDraft(card: SourceCard, detail: SourceDetail | null, ctx: { origin: string; knownCities: string[]; cityIds?: Record<string, string>; usedCodes: Set<string> }): Draft {
  const warnings: string[] = [];
  const warn = (w: string) => warnings.push(w);
  const label = parseLabel(detail?.label && / en /.test(detail.label) ? detail.label : card.label, ctx.knownCities);
  // The source's own city (breadcrumb idciudad) wins over the label: "Termas del Daymán, Salto" can be the
  // neighbourhood Termas in the city of Salto
  const srcCity = detail?.cityId ? ctx.cityIds?.[detail.cityId] : undefined;
  if (srcCity && label.city && norm(srcCity) !== norm(label.city)) {
    label.locality = label.locality ?? label.city;
    label.city = srcCity;
    label.department = departmentOf(srcCity) ?? label.department;
  } else if (srcCity && !label.city) {
    label.city = srcCity;
    label.department = departmentOf(srcCity);
  }
  const typeName = detail?.typeName || label.typeName;

  const priceTexts = detail?.prices.length ? detail.prices : card.prices;
  const prices: PriceDraft[] = [];
  for (const t of priceTexts) {
    const p = parsePrice(t, warn);
    if (p && !prices.some(x => x.operation === p.operation)) prices.push(p);
  }
  if (!prices.length) {
    const op = /alquiler/i.test(label.operation || "") ? "RENT" : "SALE";
    warn("Sin precio en el origen: se publica como «Consultar»");
    prices.push({ operation: op, amount: null, currency: op === "SALE" ? "USD" : "UYU", period: op === "SALE" ? null : "MONTH", onRequest: true });
  }

  const rawCode = (detail?.code || card.code || "").trim();
  let code = rawCode;
  if (!code) code = card.idprop;
  else if (!/\d/.test(code)) { warn(`Código en texto libre («${rawCode}»): se usa el número de la ficha ${card.idprop}`); code = card.idprop; }
  else if (ctx.usedCodes.has(code.toLowerCase())) { warn(`Código repetido («${rawCode}»): se usa el número de la ficha ${card.idprop}`); code = card.idprop; }
  ctx.usedCodes.add(code.toLowerCase());

  const features = parseFeatures([...(detail?.points ?? []), ...card.features]);
  if (!label.city) warn(`No se pudo leer la ciudad de «${card.label ?? ""}»`);
  if (label.city && !label.department) warn(`Ciudad fuera de los departamentos conocidos: ${label.city}`);

  let lat = detail?.lat ?? null, lng = detail?.lng ?? null;
  if (lat != null && lng != null && (lat < -35.2 || lat > -30 || lng < -58.6 || lng > -53)) {
    warn(`Coordenadas fuera de Uruguay (${lat}, ${lng}): se ignoran`);
    lat = lng = null;
  }
  const photos = detail?.photos.length ? detail.photos : card.photo ? [card.photo] : [];
  if (!photos.length) warn("Sin fotos");

  return {
    externalId: card.idprop,
    externalUrl: `${ctx.origin}/?idprop=${card.idprop}`,
    code,
    title: detail?.title || card.title,
    propertyType: mapType(typeName, warn),
    featured: card.featured,
    prices,
    city: label.city || "Sin ciudad",
    state: label.department,
    locality: label.locality,
    address: card.address,
    beds: features.beds, baths: features.baths, builtAreaM2: features.builtAreaM2,
    landArea: features.landArea, landAreaUnit: features.landAreaUnit, garageSpaces: features.garageSpaces,
    amenities: features.amenities,
    furnished: features.amenities.includes("amoblado"),
    description: detail?.description ?? null,
    photos,
    lat, lng,
    geoPrecision: lat != null ? "EXACT" : "APPROX",
    warnings,
  };
}
