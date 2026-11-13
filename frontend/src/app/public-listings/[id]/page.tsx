"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useI18n, SUPPORTED_LANGUAGES } from "@/lib/i18n/I18nContext";
import { useExtra } from "@/lib/i18n/extra";
import { api } from "@/lib/api";
import { fmtLocale } from "@/lib/format";
import { activePrices, formatPrice, PriceRow } from "@/lib/prices";
import { formatPhoneUY } from "@/lib/catalogs";

const INPUT = "w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm text-foreground focus:border-primary outline-none";

/**
 * Public listing page. The inquiry form creates a lead for the listing agent.
 * Add ?openhouse=1 to the URL (e.g. on a QR code at the door) to use it as an
 * open-house sign-in sheet.
 */
export default function PublicListingPage() {
  const { id } = useParams<{ id: string }>();
  const { t, language, setLanguage } = useI18n();
  void t;
  const X = useExtra();
  const P = X.publicListing;

  const [listing, setListing] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);
  const [photo, setPhoto] = useState(0);
  const [openHouse, setOpenHouse] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "", website: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setOpenHouse(new URLSearchParams(window.location.search).has("openhouse"));
    api(`/api/properties/public/${id}`, { auth: false }).then(setListing).catch(() => setNotFound(true));
  }, [id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      await api(`/api/properties/public/${id}/inquiry`, {
        method: "POST",
        auth: false,
        body: { ...form, source: openHouse ? "OPEN_HOUSE" : "WEBSITE" },
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : X.common.error);
    } finally {
      setSending(false);
    }
  };

  if (notFound) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background text-foreground p-6">
        <p className="text-foreground/60">{P.notFound}</p>
        <Link href="/public-listings" className="text-primary hover:underline">← {P.back}</Link>
      </div>
    );
  }
  if (!listing) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-foreground/50">{X.common.loading}</div>;
  }

  const photos = (listing.mediaAssets || []).filter((m: any) => m.type === "image" || !m.type);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href={listing.organization?.slug ? `/public-listings?b=${listing.organization.slug}` : "/public-listings"} className="text-sm text-foreground/60 hover:text-primary">← {P.back}</Link>
          <div className="flex items-center gap-3"><span className="text-sm font-semibold">{listing.organization?.name}</span><select value={language} onChange={e => setLanguage(e.target.value as any)} className="bg-surface border border-border text-foreground text-xs rounded-lg px-2.5 py-1 outline-none focus:border-primary cursor-pointer">{SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.short}</option>)}</select></div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <section className="lg:col-span-2 space-y-6">
          {photos.length > 0 ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photos[photo].url} alt={photos[photo].caption || listing.address} className="w-full aspect-[16/10] object-cover rounded-xl border border-border" />
              {photos.length > 1 && (
                <div className="flex gap-2 overflow-x-auto">
                  {photos.map((m: any, i: number) => (
                    <button key={m.url + i} onClick={() => setPhoto(i)} className={`flex-shrink-0 w-20 h-14 rounded-md overflow-hidden border ${i === photo ? "border-primary" : "border-border"}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="w-full aspect-[16/10] rounded-xl border border-border bg-surface flex items-center justify-center text-5xl">🏠</div>
          )}

          <div>
            <div className="text-3xl font-bold flex flex-col">
              {(activePrices(listing.prices).length ? activePrices(listing.prices) : [{ operation: "SALE", amount: listing.price, currency: "USD", onRequest: listing.price == null } as PriceRow])
                .map((p: PriceRow) => <span key={p.operation}>{formatPrice(p, X.propertyForm)}</span>)}
            </div>
            <h1 className="text-xl mt-1">{listing.address}</h1>
            <p className="text-foreground/60">{listing.city}, {listing.state} {listing.zip}{listing.neighborhood ? ` · ${listing.neighborhood}` : ""}</p>
            <div className="flex flex-wrap gap-4 mt-3 text-sm text-foreground/80">
              <span>{listing.beds} {P.beds}</span>
              <span>{listing.baths} {P.baths}</span>
              {listing.sqft && <span>{Number(listing.sqft).toLocaleString(fmtLocale())} {P.sqft}</span>}
              {listing.propertyType && <span>{String(listing.propertyType).replace(/_/g, " ")}</span>}
              {listing.yearBuilt && <span>{P.built} {listing.yearBuilt}</span>}
              {listing.status === "IN_CONTRACT" && <span className="text-amber-600 font-semibold">{P.inContract}</span>}
            </div>
          </div>
          {listing.description && <p className="text-foreground/80 leading-relaxed whitespace-pre-line">{listing.description}</p>}
          {/^https?:\/\//i.test(listing.virtualTourUrl || "") && (
            <a href={listing.virtualTourUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-primary hover:underline">{P.virtualTour} →</a>
          )}
        </section>

        <aside className="space-y-4">
          <div className="border border-border rounded-xl p-5 bg-surface/40">
            <div className="text-xs uppercase tracking-widest text-foreground/50">{P.listedBy}</div>
            <div className="font-semibold mt-1">{listing.agent?.name}</div>
            {listing.agent?.title && <div className="text-sm text-foreground/60">{listing.agent.title}</div>}
            {listing.agent?.phone && <a href={`tel:${listing.agent.phone}`} className="block text-sm text-primary mt-1">{formatPhoneUY(listing.agent.phone)}</a>}
          </div>

          <div className="border border-border rounded-xl p-5">
            <h2 className="font-semibold mb-3">{openHouse ? P.openHouseSignIn : P.contactAgent}</h2>
            {sent ? (
              <p className="text-sm text-foreground/80">✓ {P.sent}</p>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <input required placeholder={P.yourName} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT} />
                <input type="email" placeholder={P.email} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={INPUT} />
                <input type="tel" placeholder={P.phone} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={INPUT} />
                {!openHouse && (
                  <textarea rows={3} placeholder={P.messagePlaceholder} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className={`${INPUT} resize-none`} />
                )}
                {/* Honeypot for bots — hidden from people */}
                <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} className="hidden" aria-hidden="true" />
                {error && <p className="text-sm text-red-500">{error}</p>}
                <button disabled={sending} className="w-full py-2.5 bg-primary text-background rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                  {sending ? P.sending : P.send}
                </button>
              </form>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
