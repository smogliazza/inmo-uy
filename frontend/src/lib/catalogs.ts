// Uruguay catalogs (spec 7.3). Mirror of backend/src/lib/catalogs.ts; the editable ones come from the
// brokerage's policies (useSettings().policies.properties), these are the defaults and fixed lists.
export const PROPERTY_TYPES_UY = [
  "APARTAMENTO", "CASA", "TERRENO", "CAMPO_CHACRA", "LOCAL_COMERCIAL", "OFICINA",
  "GALPON", "HOTEL", "COCHERA", "EDIFICIO", "OTRO",
] as const;

export const PROPERTY_TYPES_LEGACY = ["CONDO", "COOP", "TOWNHOUSE", "SINGLE_FAMILY", "MULTI_FAMILY", "COMMERCIAL", "LAND"] as const;

export const DEPARTMENTS_UY = [
  "Artigas", "Canelones", "Cerro Largo", "Colonia", "Durazno", "Flores", "Florida", "Lavalleja", "Maldonado",
  "Montevideo", "Paysandú", "Río Negro", "Rivera", "Rocha", "Salto", "San José", "Soriano", "Tacuarembó", "Treinta y Tres",
] as const;

export const AMENITIES_UY = [
  "patio", "parrillero", "barbacoa", "jardin", "terraza", "balcon", "piscina", "ascensor", "portero", "calefaccion",
  "aire_acondicionado", "amoblado", "apto_mascotas", "vista_al_mar", "seguridad", "gimnasio", "lavadero", "deposito",
] as const;

export const CURRENCIES = ["USD", "UYU", "UI", "UR"] as const;
export type Currency = typeof CURRENCIES[number];

/** How each currency is written next to an amount: US$ 290.000 · $ 25.000 · UI 1.200 · UR 30. */
export const CURRENCY_SYMBOL: Record<Currency, string> = { USD: "US$", UYU: "$", UI: "UI", UR: "UR" };

/** "+59899991525" → "099 991 525"; "+59824001234" → "2400 1234"; anything else unchanged. */
export function formatPhoneUY(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+598(\d{8})$/.exec(e164);
  if (!m) return e164;
  const n = m[1];
  if (n.startsWith("9")) return `0${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
  return `${n.slice(0, 4)} ${n.slice(4)}`;
}
