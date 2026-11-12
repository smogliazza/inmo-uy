// Locale used for numbers and dates ("es-UY": 1.250.000 and 14,39). I18nProvider keeps it in step
// with the UI language, so plain helpers (outside React components) format consistently.
let current = "es-UY";

export function setFormatLocale(locale: string) {
  current = locale;
}

export function fmtLocale(): string {
  return current;
}

export function formatNumber(n: number | null | undefined, opts?: Intl.NumberFormatOptions): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return n.toLocaleString(current, opts);
}
