// /propiedades/{code}-{slug} — listing page (spec 8.1 / 8.4): gallery, details, map (exact or approximate),
// WhatsApp with the message already written, inquiry form, JSON-LD (RealEstateListing + Offer).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { siteContext, type SiteContext, type SiteParams } from "@/lib/site/context";
import { absoluteUrl, getListing } from "@/lib/site/server";
import { fmt, formatAmount, formatNumber, formatPrice, jsonLd, placeOf, seoTitle } from "@/lib/site/format";
import type { IndexPrice, Listing } from "@/lib/site/types";
import Gallery from "@/components/site/Gallery";
import InquiryForm from "@/components/site/InquiryForm";
import ShareButton from "@/components/site/ShareButton";
import ListingMap from "@/components/site/ListingMap";
import FavButton from "@/components/site/FavButton";
import { PhoneLink, WhatsAppButton } from "@/components/site/ContactLinks";
import { IconChevron } from "@/components/site/icons";

export const revalidate = 60; // seconds (REVALIDATE in lib/site/server.ts)
export async function generateStaticParams() { return []; }

type Props = { params: Promise<{ orgSlug: string; lang: string; ref: string }> };

async function load(params: Props["params"]): Promise<{ ctx: SiteContext; p: Listing }> {
  const ctx = await siteContext(params as SiteParams["params"]);
  const { ref } = await params;
  const p = await getListing(ctx.site.slug, decodeURIComponent(ref));
  if (!p) notFound();
  return { ctx, p };
}

const asIndex = (p: Listing) => ({ t: p.propertyType, ci: p.city, lo: p.locality, nb: p.neighborhood, bd: p.beds, p: p.prices.map(x => [x.operation, x.amount, x.currency, x.period] as IndexPrice) });

function titles(ctx: SiteContext, p: Listing) {
  const { S, locale } = ctx;
  const seo = seoTitle(asIndex(p), locale, { ...S.meta, types: S.types, opIn: S.opIn, consult: S.consult, per: S.per });
  const heading = p.title || seo.split(" — ")[0];
  return { seo, heading };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ctx, p } = await load(params);
  const { seo } = titles(ctx, p);
  const photo = p.photos[0];
  const description = (p.description || seo).replace(/\s+/g, " ").slice(0, 160);
  return {
    title: seo,
    description,
    alternates: { canonical: absoluteUrl(ctx.site, `/propiedades/${p.ref}`) },
    openGraph: { type: "website", title: seo, description, ...(photo ? { images: [{ url: photo.lg || photo.md || photo.url, alt: seo }] } : {}) },
  };
}

export default async function ListingPage({ params }: Props) {
  const { ctx, p } = await load(params);
  const { site, S, base, locale, api } = ctx;
  const { ref } = await params;
  if (decodeURIComponent(ref) !== p.ref) permanentRedirect(`${base}/propiedades/${p.ref}`); // one address per listing

  const { seo, heading } = titles(ctx, p);
  const place = placeOf(asIndex(p));
  const status = S.status[p.status as keyof typeof S.status];
  const waPhone = site.whatsapp;
  const waText = p.code ? fmt(S.wa.message, { code: p.code, title: heading }) : fmt(S.wa.messageNoCode, { title: heading });
  const n = (v: number, d = 0) => formatNumber(v, locale, d);
  const specs: [string, string][] = [
    [S.detail.type, (p.propertyType && S.types[p.propertyType]) || ""],
    [S.detail.code, p.code || ""],
    [S.detail.beds, p.beds ? n(p.beds) : ""],
    [S.detail.baths, p.baths ? n(p.baths) : ""],
    [S.detail.builtArea, p.builtAreaM2 ? fmt(S.card.m2, { n: n(p.builtAreaM2) }) : ""],
    [S.detail.landArea, p.landArea ? fmt(p.landAreaUnit === "HA" ? S.card.ha : S.card.m2, { n: n(p.landArea, 2) }) : ""],
    [S.detail.garage, p.garageSpaces ? n(p.garageSpaces) : ""],
    [S.detail.hoaFee, p.hoaFee ? formatAmount(p.hoaFee, p.hoaFeeCurrency || "UYU", locale) : ""],
    [S.detail.yearBuilt, p.yearBuilt ? String(p.yearBuilt) : ""],
    [S.detail.furnished, p.furnished ? S.detail.yes : ""],
  ].filter(([, v]) => v) as [string, string][];
  const url = absoluteUrl(site, `/propiedades/${p.ref}`);

  const ld = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: heading, url, description: p.description || seo, datePosted: p.updatedAt.slice(0, 10),
    image: p.photos.slice(0, 8).map(ph => ph.lg || ph.md || ph.url),
    offers: p.prices.map(pr => ({
      "@type": "Offer",
      businessFunction: pr.operation === "SALE" ? "http://purl.org/goodrelations/v1#Sell" : "http://purl.org/goodrelations/v1#LeaseOut",
      ...(pr.amount != null ? { price: pr.amount, priceCurrency: pr.currency } : {}),
      availability: "https://schema.org/InStock",
      seller: { "@type": "RealEstateAgent", name: site.name, ...(site.phone ? { telephone: site.phone } : {}) },
    })),
    ...(p.lat != null && p.lng != null ? { contentLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: p.locality || p.city, addressRegion: p.state || undefined, addressCountry: "UY" },
      geo: { "@type": "GeoCoordinates", latitude: p.lat, longitude: p.lng } } } : {}),
  };

  return (
    <article className="mx-auto max-w-7xl px-4 py-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <Link href={`${base}/propiedades`} className="inline-flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-brand">
        <IconChevron dir="left" width={16} height={16} /> {S.detail.back}
      </Link>

      <div className="mt-4 grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Gallery photos={p.photos} alt={heading} labels={{ ...S.detail, noPhoto: S.card.noPhoto }} />

          <header className="mt-6 flex flex-wrap items-start gap-4">
            <div className="mr-auto min-w-0">
              {status && <span className="mb-2 inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">{status}</span>}
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{heading}</h1>
              <p className="mt-1 text-slate-700">{place}{p.address ? ` · ${p.address}` : ""}</p>
            </div>
            <div className="flex items-center gap-2">
              <FavButton slug={site.slug} id={p.id} labels={S.fav} className="border border-slate-300" />
              <ShareButton api={api} slug={site.slug} propertyId={p.id} title={seo} labels={S.detail} />
            </div>
          </header>

          <ul className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
            {p.prices.map(pr => (
              <li key={pr.operation}>
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-600">{S.ops[pr.operation]}</span>
                <span className="text-2xl font-bold">{formatPrice(pr.operation, pr.amount, pr.currency, pr.period, locale, S)}</span>
              </li>
            ))}
          </ul>

          {specs.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">{S.detail.features}</h2>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                {specs.map(([k, v]) => <div key={k}><dt className="text-sm text-slate-600">{k}</dt><dd className="font-medium">{v}</dd></div>)}
              </dl>
            </section>
          )}

          {p.description && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">{S.detail.description}</h2>
              <p className="mt-3 whitespace-pre-line leading-relaxed text-slate-800">{p.description}</p>
            </section>
          )}

          {p.amenities.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">{S.detail.amenities}</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {p.amenities.map(a => <li key={a} className="rounded-full bg-slate-100 px-3 py-1 text-sm">{S.amenities[a] || a}</li>)}
              </ul>
            </section>
          )}

          {p.virtualTourUrl && /^https?:\/\//.test(p.virtualTourUrl) && (
            <p className="mt-6"><a href={p.virtualTourUrl} target="_blank" rel="noopener" className="font-semibold text-brand underline">{S.detail.virtualTour}</a></p>
          )}

          {site.modules.publicMap && p.lat != null && p.lng != null && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">{S.detail.location}</h2>
              <div className="mt-3">
                <ListingMap point={{ id: p.id, lat: p.lat, lng: p.lng, approx: p.approximate, title: heading, price: "", href: "" }}
                  brand={site.brandColor || "#0f766e"} labels={{ searchArea: S.results.searchArea, approx: S.results.approx, unavailable: S.results.mapUnavailable }} />
              </div>
              {p.approximate && <p className="mt-2 text-sm text-slate-600">{S.detail.approxNote}</p>}
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-2xl border border-slate-200 p-5 shadow-sm">
            <h2 className="text-lg font-semibold">{S.form.title}</h2>
            {p.agent && <p className="mt-1 text-sm text-slate-600">{S.detail.agent}: {p.agent.name}</p>}
            <div className="mt-4 space-y-3">
              {waPhone && <WhatsAppButton api={api} slug={site.slug} propertyId={p.id} phone={waPhone} message={waText} label={S.wa.button} />}
              {(site.phone || p.agent?.phone) && (
                <PhoneLink api={api} slug={site.slug} propertyId={p.id} phone={(site.phone || p.agent?.phone)!} label={S.wa.call}
                  className="w-full justify-center rounded-lg border border-slate-300 px-4 py-3 font-semibold hover:border-slate-500" />
              )}
            </div>
            <hr className="my-5 border-slate-200" />
            <InquiryForm api={api} slug={site.slug} propertyId={p.id} orgName={site.name} privacyHref={`${base}/p/privacidad`} S={S} />
          </div>
        </aside>
      </div>

      {waPhone && <WhatsAppButton api={api} slug={site.slug} propertyId={p.id} phone={waPhone} message={waText} label={S.wa.float} floating />}
    </article>
  );
}
