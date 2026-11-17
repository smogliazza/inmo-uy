// /robots.txt of a brokerage site. Demo sites are never indexed (spec 8.1).
import { getSite, absoluteUrl } from "@/lib/site/server";

// Rendered per request; the API answers come from the 60 s data cache
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const site = await getSite(orgSlug);
  const body = !site || site.noindex
    ? "User-agent: *\nDisallow: /\n"
    : `User-agent: *\nAllow: /\nDisallow: /favoritos\n\nSitemap: ${absoluteUrl(site, "/sitemap.xml")}\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
