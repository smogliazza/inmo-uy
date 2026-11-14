// Root layout of a brokerage site (spec 8). Reached through the proxy: /_site/{slug}/{lang}/… — the panel's
// providers, themes and dictionaries are not loaded here.
import "../../site.css";
import type { Metadata, Viewport } from "next";
import { Inter, Lora, Montserrat } from "next/font/google";
import { HTML_LANG } from "@/lib/i18n/languages";
import { siteContext, type SiteParams } from "@/lib/site/context";
import { absoluteUrl } from "@/lib/site/server";
import { fmt, onColor } from "@/lib/site/format";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const lora = Lora({ subsets: ["latin"], variable: "--font-lora", display: "swap", preload: false });
const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat", display: "swap", preload: false });
const FONTS = { sans: inter, serif: lora, modern: montserrat } as const;


export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export async function generateMetadata({ params }: SiteParams): Promise<Metadata> {
  const { site, S } = await siteContext(params);
  const description = fmt(S.meta.desc, { org: site.name });
  return {
    metadataBase: new URL(absoluteUrl(site, "/")),
    title: { default: `${S.meta.list} — ${site.name}`, template: `%s — ${site.name}` },
    description,
    applicationName: site.name,
    robots: site.noindex ? { index: false, follow: false } : { index: true, follow: true, "max-image-preview": "large" },
    openGraph: { type: "website", siteName: site.name, description, ...(site.config.heroImageUrl ? { images: [site.config.heroImageUrl] } : {}) },
    icons: site.logoUrl ? { icon: site.logoUrl } : undefined,
  };
}

export default async function SiteLayout({ children, params }: SiteParams & { children: React.ReactNode }) {
  const ctx = await siteContext(params);
  const { site, lang, S } = ctx;
  const font = FONTS[site.config.font] ?? inter;
  const brand = site.brandColor || "#0f766e";
  const style = { "--brand": brand, "--brand-fg": onColor(brand), "--font-site": `var(${font === inter ? "--font-inter" : font === lora ? "--font-lora" : "--font-montserrat"})` } as React.CSSProperties;
  return (
    <html lang={HTML_LANG[lang]} className={font.variable} style={style}>
      <body className="min-h-screen font-sans">
        {site.isDemo && <div className="bg-amber-100 py-1 text-center text-xs font-medium text-amber-900">{S.demo}</div>}
        <SiteHeader ctx={ctx} />
        <main id="contenido">{children}</main>
        <SiteFooter ctx={ctx} />
      </body>
    </html>
  );
}
