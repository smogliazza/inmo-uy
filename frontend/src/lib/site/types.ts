// Shapes of the public site API (backend/src/routes/public.ts).
import type { Currency } from "@/lib/catalogs";

export type Operation = "SALE" | "RENT" | "SEASONAL_RENT";
export type RentPeriod = "MONTH" | "WEEK" | "NIGHT" | "SEASON";

export interface SiteConfig {
  layout: "classic" | "hero" | "compact";
  font: "sans" | "serif" | "modern";
  headline: string | null;
  subheadline: string | null;
  heroImageUrl: string | null;
  banners: { title: string; text: string | null; imageUrl: string | null; href: string | null }[];
  pages: { slug: string; title: string; body: string }[];
  social: Partial<Record<"instagram" | "facebook" | "youtube" | "tiktok" | "linkedin" | "x", string>>;
  email: string | null;
  hours: string | null;
  privacyPolicy: string | null;
}

export interface Site {
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  website: string | null;
  language: string;
  currency: Currency;
  timezone: string;
  url: string | null;          // canonical address (own domain or {slug}.PLATFORM_DOMAIN); null without PLATFORM_DOMAIN
  customDomain: string | null;
  noindex: boolean;
  isDemo: boolean;
  modules: { publicMap: boolean };
  config: SiteConfig;
  listingPath?: string | null;
}

/** [operation, amount (null = "Consultar"), currency, period] */
export type IndexPrice = [Operation, number | null, Currency, RentPeriod | null];

/** One row of GET /api/public/listings/index (short keys, empty values left out). */
export interface IndexItem {
  i: string; s: string; t: string | null; st: string; p: IndexPrice[]; ci: string; u: string;
  c?: string; ti?: string; dp?: string; lo?: string; nb?: string; bd?: number; ba?: number; m2?: number;
  la?: number; lu?: "M2" | "HA"; g?: number; am?: string[]; fu?: 1; f?: 1; ll?: [number, number]; ap?: 1; ph?: string;
}

export interface ListingPhoto { url: string; caption: string | null; width: number | null; height: number | null; thumb: string | null; md: string | null; lg: string | null }
export interface ListingPrice { operation: Operation; amount: number | null; currency: Currency; period: RentPeriod | null; onRequest: boolean }

export interface Listing {
  id: string; ref: string; code: string | null; slug: string | null; title: string | null; propertyType: string | null; status: string;
  description: string | null; address: string | null; state: string | null; city: string; locality: string | null; neighborhood: string | null;
  beds: number | null; baths: number | null; builtAreaM2: number | null; landArea: number | null; landAreaUnit: "M2" | "HA" | null;
  garageSpaces: number | null; amenities: string[]; furnished: boolean; hoaFee: number | null; hoaFeeCurrency: Currency | null;
  yearBuilt: number | null; virtualTourUrl: string | null; lat: number | null; lng: number | null; approximate: boolean;
  updatedAt: string; prices: ListingPrice[]; photos: ListingPhoto[];
  agent: { name: string; phone: string | null; email: string | null; title: string | null } | null;
}
