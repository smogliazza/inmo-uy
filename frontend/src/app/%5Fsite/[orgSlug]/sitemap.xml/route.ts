// /sitemap.xml of a brokerage site (one per domain): home, listings pages, content pages and every public listing
import { getIndex, getSite, absoluteUrl } from "@/lib/site/server";

// Rendered per request; the API answers come from the 60 s data cache
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const site = await getSite(orgSlug);
  if (!site) return new Response(null, { status: 404 });
  const urls: { loc: string; lastmod?: string; priority: string }[] = [
    { loc: absoluteUrl(site, "/"), priority: "1.0" },
    { loc: absoluteUrl(site, "/propiedades"), priority: "0.9" },
    { loc: absoluteUrl(site, "/venta"), priority: "0.8" },
    { loc: absoluteUrl(site, "/alquiler"), priority: "0.8" },
    ...site.config.pages.map(p => ({ loc: absoluteUrl(site, `/p/${p.slug}`), priority: "0.4" })),
  ];
  if (!site.noindex) {
    for (const x of await getIndex(site.slug)) {
      urls.push({ loc: absoluteUrl(site, `/propiedades/${encodeURIComponent(x.c || x.i)}-${x.s}`), lastmod: x.u, priority: "0.7" });
    }
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    urls.map(u => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}<priority>${u.priority}</priority></url>`).join("\n")
  }\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
