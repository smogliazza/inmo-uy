// Home page of a brokerage site (spec 8.1): search, featured listings, notices and contact. Layout from siteConfig.
import type { Metadata } from "next";
import Link from "next/link";
import { siteContext, type SiteParams } from "@/lib/site/context";
import { absoluteUrl, getIndex } from "@/lib/site/server";
import { fmt, jsonLd } from "@/lib/site/format";
import ListingCard from "@/components/site/ListingCard";
import { WhatsAppButton } from "@/components/site/ContactLinks";
import { IconSearch } from "@/components/site/icons";

export const revalidate = 60; // seconds (REVALIDATE in lib/site/server.ts)
export async function generateStaticParams() { return []; } // built on the first visit, then refreshed every 60 s

export async function generateMetadata({ params }: SiteParams): Promise<Metadata> {
  const { site, S } = await siteContext(params);
  return { title: { absolute: `${site.config.headline || S.meta.list} — ${site.name}` }, alternates: { canonical: absoluteUrl(site, "/") } };
}

export default async function Home({ params }: SiteParams) {
  const ctx = await siteContext(params);
  const { site, S, base, locale, api } = ctx;
  const c = site.config;
  const items = await getIndex(site.slug);
  const featured = items.filter(x => x.f);
  const shown = (featured.length >= 3 ? featured : [...featured, ...items.filter(x => !x.f)]).slice(0, c.layout === "compact" ? 12 : 6);
  const hasRent = items.some(x => x.p.some(p => p[0] !== "SALE"));
  const hasSale = items.some(x => x.p.some(p => p[0] === "SALE"));
  const headline = c.headline || S.home.headline;

  const search = (
    <form action={`${base}/propiedades`} method="get" role="search" className="mx-auto flex w-full max-w-2xl flex-col gap-2 rounded-2xl bg-white p-2 shadow-lg sm:flex-row">
      {hasSale && hasRent && (
        <select name="op" aria-label={S.filters.operation} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-slate-900">
          <option value="">{S.home.anyOperation}</option>
          <option value="venta">{S.ops.SALE}</option>
          <option value="alquiler">{S.ops.RENT}</option>
        </select>
      )}
      <input name="q" type="search" aria-label={S.home.searchPlaceholder} placeholder={S.home.searchPlaceholder} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-4 py-3 text-slate-900" />
      <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3 font-semibold text-brand-fg">
        <IconSearch width={18} height={18} /> {S.home.search}
      </button>
    </form>
  );

  const org = {
    "@context": "https://schema.org", "@type": "RealEstateAgent", name: site.name, url: absoluteUrl(site, "/"),
    ...(site.logoUrl ? { logo: site.logoUrl, image: site.logoUrl } : {}),
    ...(site.phone ? { telephone: site.phone } : {}), ...(c.email ? { email: c.email } : {}),
    ...(site.address ? { address: { "@type": "PostalAddress", streetAddress: site.address, addressCountry: "UY" } } : {}),
    ...(Object.values(c.social).length ? { sameAs: Object.values(c.social) } : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(org) }} />
      {c.layout === "hero" && c.heroImageUrl ? (
        <section className="relative isolate flex min-h-[60vh] items-center px-4 py-20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.heroImageUrl} alt="" fetchPriority="high" className="absolute inset-0 -z-10 h-full w-full object-cover" />
          <div className="absolute inset-0 -z-10 bg-slate-950/50" />
          <div className="mx-auto w-full max-w-5xl text-center text-white">
            <h1 className="text-4xl font-bold tracking-tight md:text-5xl">{headline}</h1>
            {c.subheadline && <p className="mx-auto mt-4 max-w-2xl text-lg text-white/90">{c.subheadline}</p>}
            <div className="mt-8">{search}</div>
          </div>
        </section>
      ) : c.layout === "compact" ? (
        <section className="border-b border-slate-200 bg-slate-50 px-4 py-8">
          <div className="mx-auto max-w-7xl">
            <h1 className="text-3xl font-bold tracking-tight">{headline}</h1>
            {c.subheadline && <p className="mt-2 text-slate-700">{c.subheadline}</p>}
            <div className="mt-6">{search}</div>
          </div>
        </section>
      ) : (
        <section className="bg-brand px-4 py-16 text-brand-fg md:py-20">
          <div className="mx-auto max-w-5xl text-center">
            <h1 className="text-3xl font-bold tracking-tight md:text-5xl">{headline}</h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg opacity-90">{c.subheadline || fmt(S.home.count, { n: items.length.toLocaleString(locale) })}</p>
            <div className="mt-8">{search}</div>
          </div>
        </section>
      )}

      {shown.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-12">
          <div className="mb-6 flex items-end justify-between gap-4">
            <h2 className="text-2xl font-bold tracking-tight">{featured.length >= 3 ? S.home.featured : S.home.latest}</h2>
            <Link href={`${base}/propiedades`} className="text-sm font-semibold text-brand underline-offset-4 hover:underline">{S.home.seeAll}</Link>
          </div>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((x, i) => <li key={x.i}><ListingCard item={x} S={S} locale={locale} base={base} slug={site.slug} priority={i < 1 && c.layout !== "hero"} /></li>)}
          </ul>
          <div className="mt-8 text-center">
            <Link href={`${base}/propiedades`} className="inline-block rounded-full bg-brand px-6 py-3 font-semibold text-brand-fg">{S.home.seeAll}</Link>
          </div>
        </section>
      )}

      {c.banners.length > 0 && (
        <section className="mx-auto grid max-w-7xl gap-5 px-4 pb-4 md:grid-cols-2 lg:grid-cols-3">
          {c.banners.map((b, i) => {
            const inner = (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {b.imageUrl && <img src={b.imageUrl} alt="" loading="lazy" className="h-40 w-full object-cover" />}
                <div className="p-5">
                  <h3 className="font-semibold">{b.title}</h3>
                  {b.text && <p className="mt-1 text-sm text-slate-700">{b.text}</p>}
                </div>
              </>
            );
            const href = b.href?.startsWith("/") ? `${base}${b.href}` : b.href;
            return (
              <div key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {href ? <a href={href} className="block hover:bg-slate-50">{inner}</a> : inner}
              </div>
            );
          })}
        </section>
      )}

      {site.whatsapp && <WhatsAppButton api={api} slug={site.slug} phone={site.whatsapp} message={S.wa.generic} label={S.wa.float} floating />}
    </>
  );
}
