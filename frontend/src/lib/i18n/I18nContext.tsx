"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { Language, translations } from "./translations";
import { setFormatLocale } from "@/lib/format";

import { ALL_LANGUAGES, DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, FORMAT_LOCALE } from "./languages";

export { ALL_LANGUAGES, DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, FORMAT_LOCALE };

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
