"use client";
import { SUPPORTED_LANGUAGES } from "@/lib/i18n/languages";

// The language is chosen per visitor with a cookie; the proxy renders the site in it.
export default function LanguageSwitch({ current, label }: { current: string; label: string }) {
  if (SUPPORTED_LANGUAGES.length < 2) return null;
  return (
    <label className="inline-flex items-center gap-1 text-sm">
      <span className="sr-only">{label}</span>
      <select
        value={current}
        aria-label={label}
        onChange={e => {
          document.cookie = `site_lang=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
          window.location.reload();
        }}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
      >
        {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.short}</option>)}
      </select>
    </label>
  );
}
