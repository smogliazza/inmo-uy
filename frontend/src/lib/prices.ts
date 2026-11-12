// Prices per operation (spec 6.2) for display: "US$ 290.000", "$ 25.000 por mes", "Consultar".
import { CURRENCY_SYMBOL, Currency } from "@/lib/catalogs";
import { fmtLocale } from "@/lib/format";

export type Operation = "SALE" | "RENT" | "SEASONAL_RENT";
export interface PriceRow {
  operation: Operation;
  amount: string | number | null;
  currency: Currency;
  period?: "MONTH" | "WEEK" | "NIGHT" | "SEASON" | null;
  onRequest?: boolean;
  isActive?: boolean;
}

export const OPERATION_ORDER: Operation[] = ["SALE", "RENT", "SEASONAL_RENT"];

/** Labels come from useExtra().propertyForm: consult, perMONTH… */
export function formatPrice(p: PriceRow, L: { consult: string } & Record<string, string>, withPeriod = true): string {
  if (p.onRequest || p.amount === null || p.amount === "") return L.consult;
  const n = Number(p.amount);
  const amount = `${CURRENCY_SYMBOL[p.currency] ?? p.currency} ${n.toLocaleString(fmtLocale(), { maximumFractionDigits: 2 })}`;
  return withPeriod && p.period && p.operation !== "SALE" ? `${amount} ${L[`per${p.period}`] ?? ""}`.trim() : amount;
}

/** Active prices in a stable order (sale first). */
export function activePrices(prices: PriceRow[] | undefined | null): PriceRow[] {
  return (prices || []).filter(p => p.isActive !== false).sort((a, b) => OPERATION_ORDER.indexOf(a.operation) - OPERATION_ORDER.indexOf(b.operation));
}
