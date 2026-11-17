// Server-side helpers of the brokerage sites (spec 3.2 / 8): where the API is, how the site's own URLs look and
// the cached fetches the pages share. Only server components and route handlers import this file.
import { cache } from "react";
import type { IndexItem, Listing, Site } from "./types";

/**
 * With PLATFORM_DOMAIN set, each brokerage has its own host ({slug}.PLATFORM_DOMAIN or its domain) and the
 * site's paths start at "/". Without it (local development, Render), sites live at /sites/{slug}/… on the app.
 */
export const domainMode = () => !!(process.env.PLATFORM_DOMAIN || "").trim();

/** Prefix of the site's links */
export const siteBase = (slug: string) => (domainMode() ? "" : `/sites/${slug}`);

/** API base for fetches made by the web server (inside Docker: http://api:4000) */
export const serverApi = () => (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

/** API base for the browser: same origin on a brokerage host (Caddy sends /api/public/* to the API), else the app's API */
export const browserApi = () => (domainMode() ? "" : (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, ""));

/** Absolute address of a path of the site (canonical URLs, sitemap, Open Graph) */
export function absoluteUrl(site: Pick<Site, "url" | "slug">, path: string): string {
  const origin = site.url || `${(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "")}/sites/${site.slug}`;
  return `${origin}${path === "/" ? "" : path}` || origin;
}

export const REVALIDATE = 60;

async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${serverApi()}${path}`, { next: { revalidate: REVALIDATE } });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`); // an error keeps serving the last good page
  return res.json() as Promise<T>;
}

export const getSite = cache((slug: string) => getJson<Site>(`/api/public/site?site=${encodeURIComponent(slug)}`));

export const getIndex = cache(async (slug: string): Promise<IndexItem[]> => {
  const r = await getJson<{ items: IndexItem[] }>(`/api/public/listings/index?site=${encodeURIComponent(slug)}`);
  return r?.items ?? [];
});

export const getListing = cache((slug: string, ref: string) =>
  getJson<Listing>(`/api/public/listings/${encodeURIComponent(ref)}?site=${encodeURIComponent(slug)}`));
