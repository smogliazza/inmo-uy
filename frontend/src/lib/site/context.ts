// What every page of a brokerage site needs: the site, its language, dictionary and link prefix.
import { notFound } from "next/navigation";
import { extraDict, type ExtraDict } from "@/lib/i18n/extra";
import { FORMAT_LOCALE, isSupportedLanguage } from "@/lib/i18n/languages";
import type { Language } from "@/lib/i18n/translations";
import { getSite, siteBase, browserApi } from "./server";
import type { Site } from "./types";

export type SiteStrings = ExtraDict["site"] & { types: Record<string, string>; amenities: Record<string, string> };

export interface SiteContext {
  site: Site;
  lang: Language;
  locale: string;
  D: ExtraDict;
  S: SiteStrings;   // the slice client components receive
  base: string;     // prefix of the site's links ("" on its own host)
  api: string;      // API base for the browser
}

export async function siteContext(params: Promise<{ orgSlug: string; lang: string }>): Promise<SiteContext> {
  const { orgSlug, lang } = await params;
  if (!isSupportedLanguage(lang)) notFound();
  const site = await getSite(orgSlug);
  if (!site) notFound();
  const D = extraDict(lang);
  return {
    site, lang, D, locale: FORMAT_LOCALE[lang], base: siteBase(site.slug), api: browserApi(),
    S: { ...D.site, types: D.catalog.propertyTypes, amenities: D.catalog.amenities },
  };
}

export type SiteParams = { params: Promise<{ orgSlug: string; lang: string }> };
