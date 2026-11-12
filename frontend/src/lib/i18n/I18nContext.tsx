"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { Language, translations } from "./translations";
import { setFormatLocale } from "@/lib/format";

/**
 * Languages. Spanish (Uruguay) is the default; which languages the switchers offer is set with
 * NEXT_PUBLIC_SUPPORTED_LOCALES (comma-separated, default "es,en"). Chinese stays in the code, hidden.
 */
export const ALL_LANGUAGES: { code: Language; label: string; short: string }[] = [
    { code: "es",    label: "Español",  short: "ES" },
    { code: "en",    label: "English",  short: "EN" },
    { code: "zh-CN", label: "简体中文", short: "简体" },
    { code: "zh-TW", label: "繁體中文", short: "繁體" },
];
const isLanguage = (v: string): v is Language => ALL_LANGUAGES.some(l => l.code === v);
const envList = (process.env.NEXT_PUBLIC_SUPPORTED_LOCALES || "es,en").split(",").map(s => s.trim()).filter(isLanguage);
export const DEFAULT_LANGUAGE: Language = (() => {
    const d = (process.env.NEXT_PUBLIC_DEFAULT_LOCALE || "es").trim();
    return isLanguage(d) ? d : "es";
})();
/** Languages shown in the switchers (the default is always included). */
export const SUPPORTED_LANGUAGES = ALL_LANGUAGES.filter(l => l.code === DEFAULT_LANGUAGE || envList.includes(l.code));
/** BCP 47 locale for number and date formatting. */
export const FORMAT_LOCALE: Record<Language, string> = { es: "es-UY", en: "en-US", "zh-CN": "zh-CN", "zh-TW": "zh-TW" };

interface I18nContextProps {
    language: Language;
    setLanguage: (lang: Language) => void;
    t: typeof translations.en;
}

const I18nContext = createContext<I18nContextProps | undefined>(undefined);

export function I18nProvider({ children }: { children: React.ReactNode }) {
    const [language, setLanguage] = useState<Language>(DEFAULT_LANGUAGE);

    // Load preferred language from localStorage on mount (only if it is still offered)
    useEffect(() => {
        let saved = localStorage.getItem("preferredLanguage");
        if (saved === "zh") { saved = "zh-CN"; localStorage.setItem("preferredLanguage", saved); } // legacy key
        if (saved && SUPPORTED_LANGUAGES.some(l => l.code === saved)) setLanguage(saved as Language);
    }, []);

    // Keep <html lang> in step with the UI language (screen readers, hyphenation, SEO)
    useEffect(() => { document.documentElement.lang = language === "es" ? "es-UY" : language; }, [language]);

    const handleSetLanguage = (lang: Language) => {
        setLanguage(lang);
        localStorage.setItem("preferredLanguage", lang);
    };

    const t = translations[language] as typeof translations.en;
    // Set during render so every child formats numbers and dates in this language's locale
    setFormatLocale(FORMAT_LOCALE[language]);

    return (
        <I18nContext.Provider value={{ language, setLanguage: handleSetLanguage, t }}>
            {children}
        </I18nContext.Provider>
    );
}

export function useI18n() {
    const context = useContext(I18nContext);
    if (!context) {
        throw new Error("useI18n must be used within an I18nProvider");
    }
    return context;
}
