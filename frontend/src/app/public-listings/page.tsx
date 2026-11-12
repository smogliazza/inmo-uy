"use client";
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useI18n, SUPPORTED_LANGUAGES } from '@/lib/i18n/I18nContext';
import { useExtra, fmt } from '@/lib/i18n/extra';
import { fmtLocale } from "@/lib/format";

interface Property {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number | null;
  status: string;
  imageUrl?: string;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-500/15 text-green-400 border-green-500/20',
  IN_CONTRACT: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  SOLD: 'bg-foreground/10 text-foreground/40 border-border',
};

const BEDS_OPTIONS = ['Any', '1+', '2+', '3+', '4+'];
const BATHS_OPTIONS = ['Any', '1+', '2+', '3+'];

function formatPrice(price: number) {
  if (price >= 1_000_000) return `$${(price / 1_000_000).toFixed(price % 1_000_000 === 0 ? 0 : 1)}M`;
  if (price >= 1_000) return `$${(price / 1_000).toFixed(0)}K`;
  return `$${price.toLocaleString(fmtLocale())}`;
}

function PropertyCard({ property, onContact, P }: { property: Property; index: number; onContact: () => void; P: ReturnType<typeof useExtra>['publicListing'] }) {
  const imgSrc = property.imageUrl;
  const statusColor = STATUS_COLORS[property.status] || STATUS_COLORS.SOLD;
  const statusLabel = property.status === 'ACTIVE' ? P.forSale : property.status === 'IN_CONTRACT' ? P.inContract : property.status === 'SOLD' ? P.sold : property.status;

  return (
    <div className="group bg-surface border border-border rounded-xl overflow-hidden hover:border-primary/40 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 flex flex-col">
      <div className="relative h-48 overflow-hidden bg-background">
        {imgSrc ? (
          // Agents paste photo links from any host, so a plain <img> is used
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imgSrc}
            alt={property.address}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-5xl">🏠</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface/80 to-transparent" />
        <div className="absolute top-3 left-3">
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border ${statusColor}`}>
            {statusLabel}
          </span>
        </div>
        <div className="absolute bottom-3 left-3">
          <span className="text-xl font-bold text-foreground drop-shadow-lg">{formatPrice(property.price)}</span>
        </div>
      </div>

      <div className="p-4 flex flex-col flex-1">
        <div className="mb-3">
          <h3 className="font-semibold text-foreground text-sm truncate">{property.address}</h3>
          <p className="text-foreground/50 text-xs mt-0.5">{property.city}, {property.state} {property.zip}</p>
        </div>

        <div className="flex items-center gap-4 text-xs text-foreground/60 font-medium mb-4">
          <span className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            {property.beds} {P.beds}
          </span>
          <span className="w-px h-3 bg-border" />
          <span className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {property.baths} {P.baths}
          </span>
          {property.sqft && (
            <>
              <span className="w-px h-3 bg-border" />
              <span>{property.sqft.toLocaleString(fmtLocale())} {P.sqft}</span>
            </>
          )}
        </div>

        <div className="mt-auto">
          <button
            onClick={onContact}
            disabled={property.status === 'SOLD'}
            className="w-full py-2 bg-primary text-background text-xs uppercase tracking-widest font-semibold rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {property.status === 'IN_CONTRACT' ? P.inContractView : property.status === 'SOLD' ? P.sold : P.requestShowing}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PublicListingsPage() {
  const { t, language, setLanguage } = useI18n();
  void t;
  const X = useExtra();
  const P = X.publicListing;
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'IN_CONTRACT'>('ALL');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minBeds, setMinBeds] = useState('Any');
  const [minBaths, setMinBaths] = useState('Any');
  const [brokerage, setBrokerage] = useState<{ name: string; slug: string; phone?: string | null; website?: string | null; logoUrl?: string | null; brandColor?: string | null } | null>(null);
  const [problem, setProblem] = useState<'none' | 'missing' | 'notFound' | 'error'>('none');
  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  const minPriceOptions = [
    { label: P.noMin, value: '' },
    { label: '$500K', value: '500000' },
    { label: '$1M', value: '1000000' },
    { label: '$2M', value: '2000000' },
    { label: '$5M', value: '5000000' },
  ];

  const maxPriceOptions = [
    { label: P.noMax, value: '' },
    { label: '$1M', value: '1000000' },
    { label: '$2M', value: '2000000' },
    { label: '$5M', value: '5000000' },
    { label: '$10M', value: '10000000' },
  ];

  // Each brokerage has its own page: /public-listings?b=<brokerage-slug>
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('b');
    if (!slug) { setProblem('missing'); setLoading(false); return; }
    fetch(`${API}/api/properties/public?b=${encodeURIComponent(slug)}`)
      .then(async r => {
        if (r.status === 404) { setProblem('notFound'); return; }
        if (!r.ok) throw new Error(String(r.status));
        const data = await r.json();
        setBrokerage(data.organization);
        if (data.organization?.slug && data.organization.slug !== slug.toLowerCase()) { window.history.replaceState(null, '', `/public-listings?b=${encodeURIComponent(data.organization.slug)}`); }
        setProperties(Array.isArray(data.listings) ? data.listings : []);
      })
      .catch(() => setProblem('error'))
      .finally(() => setLoading(false));
  }, [API]);

  const filtered = properties.filter(p => {
    if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
    if (keyword) {
      const kw = keyword.toLowerCase();
      if (!p.address.toLowerCase().includes(kw) && !p.city.toLowerCase().includes(kw) && !p.zip.includes(kw)) return false;
    }
    if (minPrice && p.price < parseFloat(minPrice)) return false;
    if (maxPrice && p.price > parseFloat(maxPrice)) return false;
    if (minBeds !== 'Any') {
      const min = parseInt(minBeds);
      if (p.beds < min) return false;
    }
    if (minBaths !== 'Any') {
      const min = parseInt(minBaths);
      if (p.baths < min) return false;
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            {brokerage?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brokerage.logoUrl} alt="" className="w-8 h-8 object-contain" />
            ) : (
              <div className="w-8 h-8 bg-surface border border-border flex items-center justify-center font-serif text-lg text-primary">{(brokerage?.name || 'L').charAt(0)}</div>
            )}
            <span className="text-primary font-bold text-base tracking-tight hidden sm:block">{brokerage?.name || ''}</span>
            <span className="text-foreground/40 text-sm hidden sm:block">{P.listingsLabel}</span>
          </Link>
          <div className="flex items-center gap-3">
            <select
              value={language}
              onChange={e => setLanguage(e.target.value as any)}
              className="bg-surface border border-border text-foreground text-xs rounded-lg px-2.5 py-1 outline-none focus:border-primary cursor-pointer"
            >
              {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.short}</option>)}
            </select>
            <Link href="/login" className="text-xs text-foreground/50 hover:text-primary uppercase tracking-widest transition-colors hidden sm:block">{P.agentLogin}</Link>
          </div>
        </div>
      </header>

      {/* Hero / Search */}
      <section className="relative border-b border-border bg-surface overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1486325212027-8081e485255e?w=1600&q=60&auto=format')] bg-cover bg-center opacity-10 grayscale" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-2">
            {P.heroTitle1} <span className="text-primary italic">{P.heroTitle2}</span>
          </h1>
          <div className="w-16 h-px bg-primary mb-6" style={brokerage?.brandColor ? { backgroundColor: brokerage.brandColor } : undefined} />
          <p className="text-foreground/50 text-sm mb-8 max-w-xl">
            {P.heroSub}
          </p>

          {/* Search bar */}
          <div className="flex gap-3 max-w-2xl">
            <div className="flex-1 flex items-center gap-3 bg-background border border-border rounded-xl px-4 py-3 focus-within:border-primary transition-colors">
              <svg className="w-4 h-4 text-foreground/30 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                placeholder={P.searchPlaceholder}
                className="bg-transparent outline-none text-sm text-foreground placeholder:text-foreground/30 w-full"
              />
              {keyword && (
                <button onClick={() => setKeyword('')} className="text-foreground/30 hover:text-foreground transition-colors text-xs">✕</button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Filters */}
      <div className="border-b border-border bg-background sticky top-14 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
          {/* Status filters */}
          <div className="flex items-center gap-1 bg-surface rounded-lg p-1">
            {(['ALL', 'ACTIVE', 'IN_CONTRACT'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all ${
                  statusFilter === s
                    ? 'bg-primary text-background shadow-sm'
                    : 'text-foreground/50 hover:text-foreground'
                }`}
              >
                {s === 'ALL' ? P.all : s === 'ACTIVE' ? P.forSale : P.inContract}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-border hidden sm:block" />

          {/* Price filters */}
          <div className="flex items-center gap-2">
            <select
              value={minPrice}
              onChange={e => setMinPrice(e.target.value)}
              className="bg-surface border border-border text-foreground text-xs rounded-lg px-3 py-1.5 outline-none focus:border-primary transition-colors cursor-pointer"
            >
              {minPriceOptions.map(o => <option key={o.value} value={o.value} className="bg-surface">{o.label}</option>)}
            </select>
            <span className="text-foreground/30 text-xs">–</span>
            <select
              value={maxPrice}
              onChange={e => setMaxPrice(e.target.value)}
              className="bg-surface border border-border text-foreground text-xs rounded-lg px-3 py-1.5 outline-none focus:border-primary transition-colors cursor-pointer"
            >
              {maxPriceOptions.map(o => <option key={o.value} value={o.value} className="bg-surface">{o.label}</option>)}
            </select>
          </div>

          <div className="w-px h-5 bg-border hidden sm:block" />

          {/* Beds / Baths */}
          <div className="flex items-center gap-2">
            <select
              value={minBeds}
              onChange={e => setMinBeds(e.target.value)}
              className="bg-surface border border-border text-foreground text-xs rounded-lg px-3 py-1.5 outline-none focus:border-primary transition-colors cursor-pointer"
            >
              {BEDS_OPTIONS.map(o => <option key={o} value={o} className="bg-surface">{o === 'Any' ? P.anyBeds : `${o} ${P.beds}`}</option>)}
            </select>
            <select
              value={minBaths}
              onChange={e => setMinBaths(e.target.value)}
              className="bg-surface border border-border text-foreground text-xs rounded-lg px-3 py-1.5 outline-none focus:border-primary transition-colors cursor-pointer"
            >
              {BATHS_OPTIONS.map(o => <option key={o} value={o} className="bg-surface">{o === 'Any' ? P.anyBaths : `${o} ${P.baths}`}</option>)}
            </select>
          </div>

          <div className="ml-auto text-xs text-foreground/40 font-medium">
            {loading ? X.common.loading : fmt(P.propertiesCount, { n: filtered.length })}
          </div>
        </div>
      </div>

      {/* Listings Grid */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8">
        {problem !== 'none' ? (
          <div className="text-center py-20 max-w-md mx-auto">
            <h3 className="text-foreground/70 font-semibold mb-2">
              {problem === 'missing' ? P.missingSlug
                : problem === 'notFound' ? P.brokerageNotFound
                : P.loadFailed}
            </h3>
            <p className="text-foreground/40 text-sm">
              {problem === 'error' ? P.tryAgain : P.askAgentLink}
            </p>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl overflow-hidden animate-pulse">
                <div className="h-48 bg-foreground/5" />
                <div className="p-4 space-y-3">
                  <div className="h-4 bg-foreground/5 rounded w-3/4" />
                  <div className="h-3 bg-foreground/5 rounded w-1/2" />
                  <div className="h-8 bg-foreground/5 rounded mt-4" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-12 h-12 bg-surface border border-border flex items-center justify-center text-foreground/20 text-2xl mx-auto mb-6">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <h3 className="text-foreground/60 font-semibold mb-2">{properties.length === 0 ? P.noListingsNow : P.noPropsFound}</h3>
            <p className="text-foreground/30 text-sm mb-6">{P.adjustFilters}</p>
            <button
              onClick={() => { setKeyword(''); setStatusFilter('ALL'); setMinPrice(''); setMaxPrice(''); setMinBeds('Any'); setMinBaths('Any'); }}
              className="px-4 py-2 bg-surface border border-border text-foreground/60 hover:text-foreground text-xs uppercase tracking-widest rounded-lg transition-colors"
            >
              {P.clearFilters}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((p, i) => (
              <PropertyCard key={p.id} property={p} index={i} P={P} onContact={() => { window.location.href = `/public-listings/${p.id}`; }} />
            ))}
          </div>
        )}
      </main>

      {/* Sticky Contact Footer */}
      <footer className="sticky bottom-0 z-30 border-t border-border bg-background/90 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-primary/15 ring-1 ring-primary/20 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">{(brokerage?.name || 'A').charAt(0)}</div>
            <div className="min-w-0 hidden sm:block">
              <p className="text-foreground text-xs font-semibold truncate">{P.speakWithAgent}</p>
              <p className="text-foreground/40 text-xs truncate">{P.speakDesc}</p>
            </div>
          </div>
          {brokerage?.phone && (
            <a
              href={`tel:${brokerage.phone}`}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-background text-xs uppercase tracking-widest font-semibold rounded-lg hover:opacity-90 transition-all"
            >
              {P.callPrefix} {brokerage.phone}
            </a>
          )}
        </div>
      </footer>

    </div>
  );
}
