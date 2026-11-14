// Formatting for the public sites. Pure functions with an explicit locale: server components render several
// requests at once, so they cannot rely on the panel's global format locale.
import { CURRENCY_SYMBOL, type Currency } from "@/lib/catalogs";
import type { IndexItem, IndexPrice, Operation, RentPeriod } from "./types";

export interface PriceLabels { consult: string; per: Record<string, string> }

export const fmt = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));

export function formatNumber(n: number, locale: string, maxFraction = 0): string {
  return n.toLocaleString(locale, { maximumFractionDigits: maxFraction });
}

export function formatAmount(amount: number, currency: Currency, locale: string): string {
  return `${CURRENCY_SYMBOL[currency] ?? currency} ${formatNumber(amount, locale)}`;
}

/** "US$ 290.000" · "$ 25.000 por mes" · "Consultar" */
export function formatPrice(op: Operation, amount: number | null, currency: Currency, period: RentPeriod | null, locale: string, L: PriceLabels): string {
  if (amount == null) return L.consult;
  const a = formatAmount(amount, currency, locale);
  return op !== "SALE" && period ? `${a} ${L.per[period] ?? ""}`.trim() : a;
}

export const formatIndexPrice = (p: IndexPrice, locale: string, L: PriceLabels) => formatPrice(p[0], p[1], p[2], p[3], locale, L);

/** "Centro, Salto" */
export function placeOf(x: { lo?: string | null; nb?: string | null; ci: string }): string {
  const local = x.lo || x.nb;
  return local && local !== x.ci ? `${local}, ${x.ci}` : x.ci;
}

/** Area shown on cards: built area, else land (hectares for fields). */
export function areaOf(x: Pick<IndexItem, "m2" | "la" | "lu">, locale: string, L: { m2: string; ha: string }): string | null {
  if (x.m2) return fmt(L.m2, { n: formatNumber(x.m2, locale) });
  if (x.la) return fmt(x.lu === "HA" ? L.ha : L.m2, { n: formatNumber(x.la, locale, 2) });
  return null;
}

export interface TitleLabels { types: Record<string, string>; opIn: Record<string, string>; inPlace: string; dorm: string; consult: string; per: Record<string, string> }

/** "Casa en venta en Centro, Salto — 4 dorm. — US$ 290.000" (spec 8.4) */
export function seoTitle(x: { t?: string | null; p: IndexPrice[]; lo?: string | null; nb?: string | null; ci: string; bd?: number | null }, locale: string, L: TitleLabels): string {
  const type = (x.t && L.types[x.t]) || "";
  const op = x.p[0] ? L.opIn[x.p[0][0]] : "";
  const head = [type, op, fmt(L.inPlace, { place: placeOf(x) })].filter(Boolean).join(" ");
  const parts = [head.charAt(0).toUpperCase() + head.slice(1)];
  if (x.bd) parts.push(fmt(L.dorm, { n: formatNumber(x.bd, locale) }));
  if (x.p[0]) parts.push(formatIndexPrice(x.p[0], locale, L));
  return parts.join(" — ");
}

/** Text that is safe inside <script type="application/ld+json"> */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

/** Image srcset from the WebP variants (400 / 1024 / 1920 px) */
export function srcSet(p: { thumb?: string | null; md?: string | null; lg?: string | null }): string | undefined {
  const s = [p.thumb && `${p.thumb} 400w`, p.md && `${p.md} 1024w`, p.lg && `${p.lg} 1920w`].filter(Boolean);
  return s.length ? s.join(", ") : undefined;
}

/** Text color with the higher contrast on top of the brand color (white or near-black) */
export function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.062 ? "#ffffff" : "#111827";
}
