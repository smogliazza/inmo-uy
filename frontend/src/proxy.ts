// Host → brokerage site (spec 3.2). Runs before every page request.
//
// With PLATFORM_DOMAIN set:
//   app.PLATFORM_DOMAIN (and the bare / www. domain)  → the panel, as before
//   {slug}.PLATFORM_DOMAIN or a brokerage's own domain → rewritten to /_site/{slug}/{lang}/… (that brokerage only)
//   unknown host                                      → 404 with noindex
// Without it (local development, Render): sites live at /sites/{slug}/… on the app's own host.
// Everywhere: /public-listings?b={slug} and /public-listings/{id} answer 301 to the new site.
//
// The host lookup (GET /api/public/site?host=) is cached in memory for 60 s.
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANGUAGE, isSupportedLanguage } from "@/lib/i18n/languages";

const API = () => (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
const PLATFORM = () => (process.env.PLATFORM_DOMAIN || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
export const SITE_LANG_COOKIE = "site_lang";

interface SiteRef { slug: string; language: string; url: string | null; movedTo?: string; listingPath?: string | null }
type Lookup = SiteRef | null;

const cache = new Map<string, { at: number; value: Lookup }>();
const TTL_HIT = 60_000, TTL_MISS = 15_000;

async function lookup(query: string): Promise<Lookup> {
  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < (hit.value ? TTL_HIT : TTL_MISS)) return hit.value;
  const res = await fetch(`${API()}/api/public/site?${query}`, { cache: "no-store" });
  let value: Lookup = null;
  if (res.ok) {
    const s = await res.json();
    value = { slug: s.slug, language: s.language, url: s.url, listingPath: s.listingPath };
  } else if (res.status === 404) {
    const body = await res.json().catch(() => null);
    if (body?.movedTo) value = { slug: body.movedTo, language: DEFAULT_LANGUAGE, url: null, movedTo: body.movedTo };
  } else {
    throw new Error(`site lookup ${res.status}`);
  }
  if (cache.size > 2000) cache.clear();
  cache.set(query, { at: Date.now(), value });
  return value;
}

const pickLanguage = (req: NextRequest, siteLanguage: string) => {
  const c = req.cookies.get(SITE_LANG_COOKIE)?.value;
  if (isSupportedLanguage(c)) return c;
  return isSupportedLanguage(siteLanguage) ? siteLanguage : DEFAULT_LANGUAGE;
};

/** Paths that are files of the site itself rather than pages */
const SITE_FILES = new Set(["/sitemap.xml", "/robots.txt"]);

function rewriteToSite(req: NextRequest, site: SiteRef, rest: string) {
  const url = req.nextUrl.clone();
  url.pathname = SITE_FILES.has(rest)
    ? `/_site/${site.slug}${rest}`
    : `/_site/${site.slug}/${pickLanguage(req, site.language)}${rest === "/" ? "" : rest}`;
  return NextResponse.rewrite(url);
}

function notFound(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/__site-not-found"; // matches no route: global-not-found answers 404
  return NextResponse.rewrite(url, { status: 404, headers: { "X-Robots-Tag": "noindex" } });
}

const isIpOrLocal = (host: string) => host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || !host.includes(".");

export async function proxy(req: NextRequest) {
  const host = (req.headers.get("host") || "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const path = req.nextUrl.pathname;
  const base = PLATFORM();

  // Internal paths are only reachable through the rewrites below
  if (path === "/_site" || path.startsWith("/_site/")) return notFound(req);

  try {
    // A brokerage's host: everything is that brokerage's site
    if (base && host && host !== base && host !== `www.${base}` && host !== `app.${base}` && !isIpOrLocal(host)) {
      const site = await lookup(`host=${encodeURIComponent(host)}`);
      if (!site) return notFound(req);
      return rewriteToSite(req, site, path);
    }

    // Legacy public listings page → the brokerage's site
    if (path === "/public-listings" || path.startsWith("/public-listings/")) {
      const id = path.split("/")[2];
      let slug = req.nextUrl.searchParams.get("b")?.trim().toLowerCase() || "";
      if (!slug && id) {
        const r = await fetch(`${API()}/api/properties/public/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (r.ok) slug = (await r.json())?.organization?.slug || "";
      }
      if (slug) {
        const site = await lookup(`site=${encodeURIComponent(slug)}${id ? `&listing=${encodeURIComponent(id)}` : ""}`);
        if (site && !site.movedTo) {
          const root = site.url || `${req.nextUrl.origin}/sites/${site.slug}`;
          return NextResponse.redirect(`${root}${site.listingPath || ""}`, 301);
        }
        if (site?.movedTo) return NextResponse.redirect(`${req.nextUrl.origin}/public-listings?b=${site.movedTo}`, 301);
      }
      return NextResponse.next(); // the old page explains what is missing
    }

    // /sites/{slug}/… on the app's host
    if (path === "/sites" || path.startsWith("/sites/")) {
      const [, , slug = "", ...restParts] = path.split("/");
      if (!/^[a-z0-9-]{1,60}$/.test(slug)) return notFound(req);
      const rest = `/${restParts.join("/")}`;
      const site = await lookup(`site=${encodeURIComponent(slug)}`);
      if (!site) return notFound(req);
      if (site.movedTo) return NextResponse.redirect(new URL(`/sites/${site.movedTo}${rest === "/" ? "" : rest}${req.nextUrl.search}`, req.url), 301);
      // With real hosts available, the canonical address is the brokerage's own
      if (base && site.url) return NextResponse.redirect(`${site.url}${rest === "/" ? "" : rest}${req.nextUrl.search}`, 301);
      return rewriteToSite(req, site, rest);
    }
  } catch (err) {
    console.error("[proxy]", err);
    return new NextResponse(null, { status: 503, headers: { "Retry-After": "10" } });
  }
  return NextResponse.next();
}

export const config = {
  // Pages only: not Next's own files, images or the public/ folder (sitemap.xml and robots.txt do go through)
  matcher: ["/((?!_next/|favicon\\.ico|manifest\\.json|icons/|maplibre/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js|mjs|woff2?|map)$).*)"],
};
