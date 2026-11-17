// Server part of /propiedades, /venta and /alquiler: first page rendered with the filters already applied, the
// whole index handed to the browser for instant filtering.
import type { SiteContext } from "@/lib/site/context";
import { getIndex } from "@/lib/site/server";
import { parseFilters } from "@/lib/site/filter";
import type { Operation } from "@/lib/site/types";
import Listings from "./Listings";
import { WhatsAppButton } from "./ContactLinks";

export default async function ListingsPage({ ctx, title, path, op = null, query }: {
  ctx: SiteContext; title: string; path: string; op?: Operation | null;
  query?: Record<string, string | string[] | undefined>; // undefined on static pages: the browser applies the URL
}) {
  const { site, S, locale, base, api } = ctx;
  const items = await getIndex(site.slug);
  const initial = parseFilters(query ?? {}, { op });
  return (
    <>
      <div className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        </div>
      </div>
      <Listings items={items} initial={initial} impliedOp={op} pagePath={`${base}${path}`} S={S} locale={locale} base={base} slug={site.slug}
        brand={site.brandColor || "#0f766e"} siteCurrency={site.currency} mapOn={site.modules.publicMap} readUrl={!query} />
      {site.whatsapp && <WhatsAppButton api={api} slug={site.slug} phone={site.whatsapp} message={S.wa.generic} label={S.wa.float} floating />}
    </>
  );
}
