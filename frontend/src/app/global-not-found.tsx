// 404 for addresses that match no page (the panel and the brokerage sites have separate root layouts, so this
// one renders on its own). Unknown brokerage hosts land here too, with noindex.
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { extraDict } from "@/lib/i18n/extra";
import { DEFAULT_LANGUAGE, HTML_LANG } from "@/lib/i18n/languages";

const T = extraDict(DEFAULT_LANGUAGE).site.notFound;

export const metadata: Metadata = { title: T.title, robots: { index: false, follow: false } };

export default function GlobalNotFound() {
  return (
    <html lang={HTML_LANG[DEFAULT_LANGUAGE]}>
      <body>
        <main className="min-h-screen flex flex-col items-center justify-center text-center p-8">
          <div className="text-8xl font-bold opacity-10 mb-4 select-none">404</div>
          <h1 className="text-2xl font-bold mb-3">{T.title}</h1>
          <p className="opacity-60 text-sm mb-8 max-w-sm">{T.text}</p>
          <Link href="/" className="px-6 py-3 bg-primary text-background text-sm font-semibold rounded-lg hover:opacity-90">{T.home}</Link>
        </main>
      </body>
    </html>
  );
}
