// Languages offered by the UI (no React here, so server components and the proxy can use it too).
// Spanish (Uruguay) is the default; NEXT_PUBLIC_SUPPORTED_LOCALES (comma-separated, default "es,en") sets which
// ones the switchers offer. Chinese stays in the code, hidden.
import type { Language } from "./translations";

export const ALL_LANGUAGES: { code: Language; label: string; short: string }[] = [
    { code: "es",    label: "Español",  short: "ES" },
    { code: "en",    label: "English",  short: "EN" },
    { code: "zh-CN", label: "简体中文", short: "简体" },
    { code: "zh-TW", label: "繁體中文", short: "繁體" },
];
export const isLanguage = (v: string): v is Language => ALL_LANGUAGES.some(l => l.code === v);
const envList = (process.env.NEXT_PUBLIC_SUPPORTED_LOCALES || "es,en").split(",").map(s => s.trim()).filter(isLanguage);
export const DEFAULT_LANGUAGE: Language = (() => {
    const d = (process.env.NEXT_PUBLIC_DEFAULT_LOCALE || "es").trim();
    return isLanguage(d) ? d : "es";
})();
/** Languages shown in the switchers (the default is always included). */
export const SUPPORTED_LANGUAGES = ALL_LANGUAGES.filter(l => l.code === DEFAULT_LANGUAGE || envList.includes(l.code));
export const isSupportedLanguage = (v: string | null | undefined): v is Language => !!v && SUPPORTED_LANGUAGES.some(l => l.code === v);
/** BCP 47 locale for number and date formatting. */
export const FORMAT_LOCALE: Record<Language, string> = { es: "es-UY", en: "en-US", "zh-CN": "zh-CN", "zh-TW": "zh-TW" };
/** <html lang> value. */
export const HTML_LANG: Record<Language, string> = { es: "es-UY", en: "en", "zh-CN": "zh-CN", "zh-TW": "zh-TW" };
