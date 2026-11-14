"use client";
// Listings of a brokerage site with instant filters (spec 8.2): the whole public index is in the page and every
// filter, counter and sort runs in memory. The state lives in the URL (shareable; Back works). The map is loaded
// only when the visitor opens it and always shows the same filtered results as the list.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Currency } from "@/lib/catalogs";
import { CURRENCY_SYMBOL } from "@/lib/catalogs";
import type { SiteStrings } from "@/lib/site/context";
import type { IndexItem, Operation } from "@/lib/site/types";
import {
  activeFilterCount, applyFilters, EMPTY_FILTERS, facetCounts, filtersToQuery, parseFilters, prepare, priceCurrency,
  zoneOptions, type Filters, type SortKey, type ViewKey,
} from "@/lib/site/filter";
import { fmt, formatIndexPrice, placeOf } from "@/lib/site/format";
import ListingCard, { listingHref } from "./ListingCard";
import type { MapPoint } from "./SiteMap";
import { IconClose, IconFilter, IconSearch } from "./icons";

const SiteMap = dynamic(() => import("./SiteMap"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-2xl bg-slate-100" /> });

const PAGE = 24;
const OPS: Operation[] = ["SALE", "RENT", "SEASONAL_RENT"];

export default function Listings({ items, initial, impliedOp, pagePath, S, locale, base, slug, brand, siteCurrency, mapOn, readUrl = false }: {
  items: IndexItem[];
  readUrl?: boolean;
  initial: Filters;
  impliedOp: Operation | null;
  pagePath: string;
  S: SiteStrings;
  locale: string;
  base: string;
  slug: string;
  brand: string;
  siteCurrency: Currency;
  mapOn: boolean;
}) {
  const [f, setF] = useState<Filters>(initial);
  const [shown, setShown] = useState(PAGE);
  const [panel, setPanel] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  const prepared = useMemo(() => prepare(items, S), [items, S]);
  const zones = useMemo(() => zoneOptions(items), [items]);
  const results = useMemo(() => applyFilters(prepared, f, siteCurrency), [prepared, f, siteCurrency]);
  const counts = useMemo(() => facetCounts(prepared, f, siteCurrency), [prepared, f, siteCurrency]);
  const typesPresent = useMemo(() => [...new Set(items.map(x => x.t).filter((t): t is string => !!t))], [items]);
  const amenitiesPresent = useMemo(() => [...new Set(items.flatMap(x => x.am || []))].sort(), [items]);
  const opsPresent = useMemo(() => OPS.filter(op => items.some(x => x.p.some(p => p[0] === op))), [items]);
  const cur = priceCurrency(f, siteCurrency);
  const currencies = useMemo(() => {
    const set = new Set<Currency>([cur]);
    for (const x of items) for (const p of x.p) if (!f.op || p[0] === f.op) set.add(p[2]);
    return [...set];
  }, [items, f.op, cur]);

  // Keep the URL in step: clicks add a history entry (Back undoes them), typing replaces it
  const update = useCallback((patch: Partial<Filters>, replace = false) => {
    const next = { ...f, ...patch };
    setF(next);
    setShown(PAGE);
    try { window.history[replace ? "replaceState" : "pushState"](null, "", `${pagePath}${filtersToQuery(next, impliedOp)}`); } catch { /* ignore */ }
  }, [f, pagePath, impliedOp]);

  // Static pages (/venta, /alquiler) are rendered without the query: apply it once in the browser
  useEffect(() => {
    if (readUrl && window.location.search) setF(parseFilters(new URLSearchParams(window.location.search), { op: impliedOp }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPop = () => { setF(parseFilters(new URLSearchParams(window.location.search), { op: impliedOp })); setShown(PAGE); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [impliedOp]);

  const clear = () => update({ ...EMPTY_FILTERS, op: impliedOp ?? null, sort: f.sort, view: f.view });
  const nActive = activeFilterCount(f);
  const view: ViewKey = mapOn ? f.view : "list";

  const points: MapPoint[] = useMemo(() => results.filter(x => x.item.ll).map(({ item: x }) => ({
    id: x.i, lat: x.ll![0], lng: x.ll![1], approx: !!x.ap, href: listingHref(base, x),
    title: x.ti || `${(x.t && S.types[x.t]) || ""} · ${placeOf(x)}`, price: x.p[0] ? formatIndexPrice(x.p[0], locale, S) : "",
  })), [results, base, S, locale]);
  const withoutLocation = results.length - points.length;

  const countLabel = results.length === 1 ? S.results.one : fmt(S.results.count, { n: results.length.toLocaleString(locale) });
  const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-sm transition ${on ? "border-brand bg-brand text-brand-fg" : "border-slate-300 bg-white text-slate-800 hover:border-slate-500"}`;
  const num = (v: string) => { const d = v.replace(/\D/g, ""); return d ? Number(d) : null; };

  const filtersPanel = (
    <div className="space-y-6">
      <div>
        <label htmlFor="f-zone" className="mb-1.5 block text-sm font-semibold">{S.filters.place}</label>
        <select id="f-zone" value={f.zone ?? ""} onChange={e => update({ zone: e.target.value || null })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">{S.filters.anyPlace}</option>
          {zones.map(z => (
            <option key={z.key} value={z.key} disabled={!counts.zone[z.key] && f.zone !== z.key}>
              {z.key.includes("--") ? `  ${z.label}` : z.label} ({counts.zone[z.key] ?? 0})
            </option>
          ))}
        </select>
      </div>

      {typesPresent.length > 1 && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">{S.filters.type}</legend>
          <div className="flex flex-wrap gap-2">
            {typesPresent.map(t => {
              const on = f.types.includes(t);
              return (
                <button key={t} type="button" aria-pressed={on} className={chip(on)} disabled={!on && !counts.types[t]}
                  onClick={() => update({ types: on ? f.types.filter(x => x !== t) : [...f.types, t] })}>
                  {S.types[t] || t} <span className="opacity-90">({counts.types[t] ?? 0})</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{S.filters.price}</legend>
        <div className="grid grid-cols-[auto_1fr_1fr] gap-2">
          <label className="sr-only" htmlFor="f-cur">{S.filters.currency}</label>
          <select id="f-cur" value={cur} onChange={e => update({ cur: e.target.value as Currency })} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm">
            {currencies.map(c => <option key={c} value={c}>{CURRENCY_SYMBOL[c]}</option>)}
          </select>
          <input inputMode="numeric" aria-label={`${S.filters.price} ${S.filters.priceMin}`} placeholder={S.filters.priceMin}
            value={f.min != null ? f.min.toLocaleString(locale) : ""} onChange={e => update({ min: num(e.target.value), cur }, true)}
            className="min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input inputMode="numeric" aria-label={`${S.filters.price} ${S.filters.priceMax}`} placeholder={S.filters.priceMax}
            value={f.max != null ? f.max.toLocaleString(locale) : ""} onChange={e => update({ max: num(e.target.value), cur }, true)}
            className="min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <p className="mt-1 text-xs text-slate-600">{S.results.priceNote}</p>
      </fieldset>

      {([["beds", S.filters.beds, 5], ["baths", S.filters.baths, 4]] as const).map(([key, label, max]) => (
        <fieldset key={key}>
          <legend className="mb-2 text-sm font-semibold">{label}</legend>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={!f[key]} className={chip(!f[key])} onClick={() => update({ [key]: null })}>{S.filters.any}</button>
            {Array.from({ length: max }, (_, i) => i + 1).map(n => (
              <button key={n} type="button" aria-pressed={f[key] === n} className={chip(f[key] === n)} disabled={f[key] !== n && !counts[key][String(n)]}
                onClick={() => update({ [key]: n })}>{fmt(S.filters.plus, { n })}</button>
            ))}
          </div>
        </fieldset>
      ))}

      <div>
        <label htmlFor="f-area" className="mb-1.5 block text-sm font-semibold">{S.filters.minArea}</label>
        <input id="f-area" inputMode="numeric" value={f.area ?? ""} onChange={e => update({ area: num(e.target.value) }, true)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>

      {amenitiesPresent.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">{S.filters.amenities}</legend>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {amenitiesPresent.map(a => {
              const on = f.am.includes(a);
              return (
                <label key={a} className={`flex items-center gap-2 text-sm ${!on && !counts.am[a] ? "opacity-50" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => update({ am: on ? f.am.filter(x => x !== a) : [...f.am, a] })} className="h-4 w-4 accent-[var(--brand)]" />
                  {S.amenities[a] || a} <span className="text-slate-500">({counts.am[a] ?? 0})</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {nActive > 0 && <button type="button" onClick={clear} className="text-sm font-semibold text-brand underline underline-offset-4">{S.filters.clear}</button>}
    </div>
  );

  const list = (cols: string) => (
    <>
      {results.length === 0
        ? <p className="rounded-2xl bg-slate-50 p-8 text-center text-slate-700">{S.results.none}</p>
        : <ul className={`grid gap-5 ${cols}`}>
            {results.slice(0, shown).map((x, i) => (
              <li key={x.item.i}><ListingCard item={x.item} S={S} locale={locale} base={base} slug={slug} priority={i < 2} onHover={view === "split" ? setHover : undefined} /></li>
            ))}
          </ul>}
      {results.length > shown && (
        <div className="mt-8 text-center">
          <button type="button" onClick={() => setShown(n => n + PAGE)} className="rounded-full border border-slate-300 px-6 py-2.5 font-semibold hover:border-slate-500">{S.results.loadMore}</button>
        </div>
      )}
    </>
  );

  const map = (cls: string) => (
    <div className={cls}>
      <SiteMap points={points} brand={brand} hoverId={hover} labels={{ searchArea: S.results.searchArea, approx: S.results.approx, unavailable: S.results.mapUnavailable }}
        onSearchArea={bbox => update({ bbox })} className="h-full" />
      {withoutLocation > 0 && <p className="mt-2 text-xs text-slate-600">{fmt(S.results.noMap, { n: withoutLocation })}</p>}
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Operation + text: always visible */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        {opsPresent.length > 1 && (
          <div role="group" aria-label={S.filters.operation} className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={!f.op} className={chip(!f.op)} onClick={() => update({ op: null, cur: null })}>{S.home.anyOperation} <span className="opacity-90">({counts.op.ALL ?? 0})</span></button>
            {opsPresent.map(op => (
              <button key={op} type="button" aria-pressed={f.op === op} className={chip(f.op === op)} onClick={() => update({ op, cur: null })}>
                {S.ops[op]} <span className="opacity-90">({counts.op[op] ?? 0})</span>
              </button>
            ))}
          </div>
        )}
        <div className="relative md:ml-auto md:w-80">
          <IconSearch width={18} height={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="search" aria-label={S.filters.text} placeholder={S.filters.textPlaceholder} value={f.q}
            onChange={e => update({ q: e.target.value }, true)} className="w-full rounded-full border border-slate-300 py-2 pl-10 pr-4 text-sm" />
        </div>
        <button type="button" onClick={() => setPanel(true)} className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold lg:hidden">
          <IconFilter width={18} height={18} /> {S.filters.title}{nActive > 0 && <span className="rounded-full bg-brand px-1.5 text-xs text-brand-fg">{nActive}</span>}
        </button>
      </div>

      <div className="mt-6 flex gap-8">
        {/* Filters: sidebar on wide screens, full-screen panel on phones */}
        <aside className="hidden w-72 shrink-0 lg:block" aria-label={S.filters.title}>{filtersPanel}</aside>
        {panel && (
          <div className="fixed inset-0 z-50 flex flex-col bg-white lg:hidden" role="dialog" aria-modal="true" aria-label={S.filters.title}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <p className="font-semibold">{S.filters.title}</p>
              <button type="button" onClick={() => setPanel(false)} aria-label={S.filters.close} className="rounded-md p-2 hover:bg-slate-100"><IconClose /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{filtersPanel}</div>
            <div className="border-t border-slate-200 p-4">
              <button type="button" onClick={() => setPanel(false)} className="w-full rounded-full bg-brand py-3 font-semibold text-brand-fg">{fmt(S.filters.show, { n: results.length })}</button>
            </div>
          </div>
        )}

        <section className="min-w-0 flex-1" aria-live="polite">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="mr-auto text-lg font-semibold">{countLabel}</h2>
            {f.bbox && (
              <button type="button" onClick={() => update({ bbox: null })} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-sm">
                {S.results.clearArea} <IconClose width={14} height={14} />
              </button>
            )}
            <label className="inline-flex items-center gap-2 text-sm">
              <span className="text-slate-600">{S.results.sort}</span>
              <select value={f.sort} onChange={e => update({ sort: e.target.value as SortKey })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
                <option value="relevance">{S.results.sortRecent}</option>
                <option value="price-asc">{S.results.sortPriceAsc}</option>
                <option value="price-desc">{S.results.sortPriceDesc}</option>
                <option value="area">{S.results.sortArea}</option>
              </select>
            </label>
            {mapOn && (
              <div role="group" className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm">
                {(["list", "split", "map"] as ViewKey[]).map(v => (
                  <button key={v} type="button" aria-pressed={view === v} onClick={() => update({ view: v })}
                    className={`px-3 py-1.5 ${view === v ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"} ${v === "split" ? "hidden lg:block" : ""}`}>
                    {v === "list" ? S.results.viewList : v === "map" ? S.results.viewMap : S.results.viewSplit}
                  </button>
                ))}
              </div>
            )}
          </div>

          {view === "list" && list("sm:grid-cols-2 xl:grid-cols-3")}
          {view === "map" && map("h-[70vh]")}
          {view === "split" && (
            <div className="grid gap-6 lg:grid-cols-2">
              <div>{list("sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2")}</div>
              {map("lg:sticky lg:top-20 h-[60vh] lg:h-[calc(100vh-6rem)]")}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
