"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useI18n } from "@/lib/i18n/I18nContext";
import { useExtra } from "@/lib/i18n/extra";
import { useToast } from "@/components/ui/Toast";
import { useSettings } from "@/lib/settings/useSettings";
import { api } from "@/lib/api";
import { CURRENCIES, DEPARTMENTS_UY, Currency } from "@/lib/catalogs";
import { Operation, OPERATION_ORDER } from "@/lib/prices";

/**
 * Create / edit a listing (spec 6 and phase F3): tabs Details, Prices (one row per operation: sale and rent can
 * coexist, "Consultar" when there is no published price) and Location (pin on the map + address search).
 * Photos stay in the media manager. Required fields follow spec 6.1 plus the brokerage's listing policy.
 */
const LocationPicker = dynamic(() => import("./LocationPicker"), { ssr: false });

type Period = "MONTH" | "WEEK" | "NIGHT" | "SEASON";
interface PriceDraft { operation: Operation; amount: string; currency: Currency; period: Period | null; onRequest: boolean }
type GeoPrecision = "EXACT" | "APPROX" | "HIDDEN";

const STATUSES = ["COMING_SOON", "ACTIVE", "RESERVED", "IN_CONTRACT", "SOLD", "RENTED", "WITHDRAWN"] as const;
const RESIDENTIAL = ["APARTAMENTO", "CASA", "CONDO", "COOP", "TOWNHOUSE", "SINGLE_FAMILY", "MULTI_FAMILY"];
const INPUT = "w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all shadow-sm";
const SELECT = `${INPUT} appearance-none cursor-pointer`;
const LABEL = "block font-sans text-sm font-semibold text-foreground/60 mb-2";

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export default function PropertyForm({ propertyId, onClose, onSaved }: {
  /** null = create */
  propertyId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const X = useExtra();
  const F = X.propertyForm;
  const toast = useToast();
  const { policies, preferences } = useSettings();
  const pp = policies.properties;
  const isReq = (f: string, type?: string) =>
    pp.requiredFields.includes(f) && (!["beds", "baths"].includes(f) || !type || RESIDENTIAL.includes(type));

  const [tab, setTab] = React.useState<"data" | "prices" | "location">("data");
  const [loading, setLoading] = React.useState(propertyId !== null);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState(() => ({
    propertyType: "", address: "", locality: "", city: "", state: "", zip: "", neighborhood: "",
    beds: "", baths: "", builtAreaM2: "", landArea: "", landAreaUnit: "M2" as "M2" | "HA", garageSpaces: "",
    furnished: false, amenities: [] as string[], code: "", padron: "", yearBuilt: "", description: "",
    status: pp.photosRequiredToActivate > 0 ? "COMING_SOON" : preferences.properties.defaultStatus,
    isPublic: true, hoaFee: "", hoaFeeCurrency: "UYU" as Currency, sqft: "", mlsNumber: "",
    lat: null as number | null, lng: null as number | null, geoPrecision: "EXACT" as GeoPrecision,
  }));
  const [prices, setPrices] = React.useState<PriceDraft[]>([{ operation: "SALE", amount: "", currency: "USD", period: null, onRequest: false }]);
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  // Edit: load the full listing (all its prices)
  React.useEffect(() => {
    if (!propertyId) return;
    api(`/api/properties/${propertyId}`).then((p: any) => {
      setForm(f => ({
        ...f,
        propertyType: str(p.propertyType), address: str(p.address), locality: str(p.locality), city: str(p.city), state: str(p.state),
        zip: str(p.zip), neighborhood: str(p.neighborhood), beds: str(p.beds), baths: str(p.baths), builtAreaM2: str(p.builtAreaM2),
        landArea: str(p.landArea), landAreaUnit: p.landAreaUnit === "HA" ? "HA" : "M2", garageSpaces: str(p.garageSpaces ?? p.parkingSpaces),
        furnished: !!p.furnished, amenities: Array.isArray(p.amenities) ? p.amenities : [], code: str(p.code), padron: str(p.padron),
        yearBuilt: str(p.yearBuilt), description: str(p.description), status: p.status, isPublic: p.isPublic !== false,
        hoaFee: str(p.hoaFee), hoaFeeCurrency: p.hoaFeeCurrency || "UYU", sqft: str(p.sqft), mlsNumber: str(p.mlsNumber),
        lat: p.lat ?? null, lng: p.lng ?? null, geoPrecision: p.geoPrecision || "EXACT",
      }));
      const active = (p.prices || []).filter((x: any) => x.isActive !== false);
      setPrices(active.length ? active.map((x: any) => ({
        operation: x.operation, amount: x.amount === null ? "" : String(Number(x.amount)), currency: x.currency, period: x.period, onRequest: !!x.onRequest,
      })) : [{ operation: "SALE", amount: p.price ? String(p.price) : "", currency: "USD", period: null, onRequest: !p.price }]);
    }).catch((err) => toast.error(err instanceof Error ? err.message : X.common.error)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  // ── Prices ──
  const missingOps = OPERATION_ORDER.filter(op => !prices.some(p => p.operation === op));
  const setPrice = (i: number, patch: Partial<PriceDraft>) => setPrices(ps => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const addOperation = (op: Operation) => setPrices(ps => [...ps, {
    operation: op, amount: "", currency: op === "SALE" ? "USD" : "UYU", period: op === "RENT" ? "MONTH" : op === "SEASONAL_RENT" ? "SEASON" : null, onRequest: false,
  }]);

  // ── Address search ──
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<{ lat: number; lng: number; label: string; precision: GeoPrecision }[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [mapFailed, setMapFailed] = React.useState(false);
  const search = async () => {
    const q = query.trim() || [form.address, form.locality, form.city, form.state, "Uruguay"].filter(Boolean).join(", ");
    if (q.length < 3) return;
    setSearching(true);
    try {
      const r = await api(`/api/properties/geocode?q=${encodeURIComponent(q)}`);
      setResults(r.results || []);
    } catch {
      toast.error(F.searchFailed);
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  // ── Zillow import (New York setting only) ──
  const [zpid, setZpid] = React.useState("");
  const [zLoading, setZLoading] = React.useState(false);
  const zillow = async () => {
    if (!zpid) { toast.error(X.catalog.zillowMissing); return; }
    setZLoading(true);
    try {
      const { data } = await api(`/api/integrations/zillow/fetch?zpid=${encodeURIComponent(zpid)}`);
      const parts = String(data.address || "").split(", ");
      set({ address: parts[0] || "", city: parts[1] || "", state: parts[2]?.split(" ")[0] || "", zip: parts[2]?.split(" ")[1] || "",
        beds: data.beds ? String(data.beds) : form.beds, baths: data.baths ? String(data.baths) : form.baths, sqft: data.sqft ? String(data.sqft) : form.sqft });
      if (data.price) setPrices([{ operation: "SALE", amount: String(data.price), currency: "USD", period: null, onRequest: false }]);
    } catch {
      toast.error(X.catalog.zillowFailed);
    } finally {
      setZLoading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prices.length) { setTab("prices"); toast.error(F.needOperation); return; }
    setSaving(true);
    const body: Record<string, unknown> = {
      ...form,
      prices: prices.map(p => ({ operation: p.operation, amount: p.onRequest ? null : p.amount, currency: p.currency, period: p.period, onRequest: p.onRequest || !p.amount })),
      landAreaUnit: form.landArea ? form.landAreaUnit : null,
      hoaFeeCurrency: form.hoaFee ? form.hoaFeeCurrency : null,
    };
    if (!pp.usStyleDeal) { delete body.sqft; delete body.mlsNumber; }
    try {
      await api(propertyId ? `/api/properties/${propertyId}` : "/api/properties", { method: propertyId ? "PATCH" : "POST", body });
      toast.success(propertyId ? F.saved : F.created);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : X.common.error);
    } finally {
      setSaving(false);
    }
  };

  const star = (f: string) => (isReq(f, form.propertyType) ? " *" : "");
  const typeOptions = [...pp.propertyTypes, ...(form.propertyType && !pp.propertyTypes.includes(form.propertyType) ? [form.propertyType] : [])];
  const amenityOptions = [...pp.amenities, ...form.amenities.filter(a => !pp.amenities.includes(a))];
  const label = (map: Record<string, string>, k: string) => map[k] ?? k.replace(/_/g, " ").toLowerCase();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-300 p-4">
      <div className="bg-surface border border-border/60 rounded-3xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl">
        <div className="px-8 pt-6 border-b border-border/60">
          <div className="flex items-center justify-between">
            <h2 className="font-sans text-2xl font-bold text-foreground">{propertyId ? F.editTitle : F.createTitle}</h2>
            <button type="button" onClick={onClose} aria-label={X.common.close} className="p-2 text-foreground/50 hover:text-foreground">✕</button>
          </div>
          <div className="flex gap-6 mt-4" role="tablist">
            {(["data", "prices", "location"] as const).map(k => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`pb-3 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === k ? "border-primary text-primary" : "border-transparent text-foreground/50 hover:text-foreground"}`}>
                {k === "data" ? F.tabData : k === "prices" ? F.tabPrices : F.tabLocation}
              </button>
            ))}
          </div>
        </div>

        {loading ? <div className="p-10 text-foreground/50">{X.common.loading}</div> : (
        <form onSubmit={submit} className="flex-1 overflow-y-auto p-8 space-y-6">
          {tab === "data" && (<>
            {pp.usStyleDeal && !propertyId && (
              <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5 flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 w-full">
                  <label className={LABEL}>{X.catalog.zillowTitle}</label>
                  <input className={INPUT} value={zpid} onChange={e => setZpid(e.target.value)} placeholder={X.catalog.zillowPlaceholder} />
                </div>
                <button type="button" onClick={zillow} disabled={zLoading} className="px-5 py-3 rounded-xl border border-primary text-primary font-semibold">
                  {zLoading ? X.catalog.zillowLoading : X.catalog.zillowBtn}
                </button>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <label className={LABEL}>{F.type} *</label>
                <select required className={SELECT} value={form.propertyType} onChange={e => set({ propertyType: e.target.value })}>
                  <option value="">{X.catalog.choose}</option>
                  {typeOptions.map(v => <option key={v} value={v}>{label(X.catalog.propertyTypes as Record<string, string>, v)}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>{F.status}</label>
                <select className={SELECT} value={form.status} onChange={e => set({ status: e.target.value })}>
                  {STATUSES.map(s => <option key={s} value={s}>{label(X.labels.propertyStatus as Record<string, string>, s)}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>{F.code}{star("code")}</label>
                <input className={INPUT} value={form.code} onChange={e => set({ code: e.target.value })} title={F.codeHint} />
              </div>
            </div>
            <div>
              <label className={LABEL}>{F.address}</label>
              <input className={INPUT} value={form.address} onChange={e => set({ address: e.target.value })} placeholder={X.labels.addressPlaceholder} />
              <p className="text-xs text-foreground/40 mt-1">{F.addressHint}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <label className={LABEL}>{F.locality}{star("locality")}</label>
                <input className={INPUT} value={form.locality} onChange={e => set({ locality: e.target.value })} />
              </div>
              <div>
                <label className={LABEL}>{F.city} *</label>
                <input required className={INPUT} value={form.city} onChange={e => set({ city: e.target.value })} />
              </div>
              <div>
                <label className={LABEL}>{X.catalog.department}{star("state")}</label>
                <select className={SELECT} value={form.state} onChange={e => set({ state: e.target.value })}>
                  <option value="">{X.catalog.choose}</option>
                  {[...DEPARTMENTS_UY, ...(form.state && !(DEPARTMENTS_UY as readonly string[]).includes(form.state) ? [form.state] : [])].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              <div>
                <label className={LABEL}>{F.beds}{star("beds")}</label>
                <input inputMode="decimal" className={INPUT} value={form.beds} onChange={e => set({ beds: e.target.value })} />
              </div>
              <div>
                <label className={LABEL}>{F.baths}{star("baths")}</label>
                <input inputMode="decimal" className={INPUT} value={form.baths} onChange={e => set({ baths: e.target.value })} />
              </div>
              <div>
                <label className={LABEL}>{F.garage}</label>
                <input inputMode="numeric" className={INPUT} value={form.garageSpaces} onChange={e => set({ garageSpaces: e.target.value })} />
              </div>
              <div>
                <label className={LABEL}>{F.builtArea}{star("builtAreaM2")}</label>
                <input inputMode="decimal" className={INPUT} value={form.builtAreaM2} onChange={e => set({ builtAreaM2: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="md:col-span-2">
                <label className={LABEL}>{F.landArea}{star("landArea")}</label>
                <div className="flex gap-2">
                  <input inputMode="decimal" className={INPUT} value={form.landArea} onChange={e => set({ landArea: e.target.value })} />
                  <select className={`${SELECT} w-28`} value={form.landAreaUnit} onChange={e => set({ landAreaUnit: e.target.value as "M2" | "HA" })}>
                    <option value="M2">{F.unitM2}</option>
                    <option value="HA">{F.unitHa}</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={LABEL}>{F.padron}{star("padron")}</label>
                <input className={INPUT} value={form.padron} onChange={e => set({ padron: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="md:col-span-2">
                <label className={LABEL}>{F.hoaFee}</label>
                <div className="flex gap-2">
                  <input inputMode="decimal" className={INPUT} value={form.hoaFee} onChange={e => set({ hoaFee: e.target.value })} />
                  <select className={`${SELECT} w-28`} value={form.hoaFeeCurrency} onChange={e => set({ hoaFeeCurrency: e.target.value as Currency })} aria-label={F.hoaCurrency}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={LABEL}>{F.yearBuilt}{star("yearBuilt")}</label>
                <input inputMode="numeric" className={INPUT} value={form.yearBuilt} onChange={e => set({ yearBuilt: e.target.value })} />
              </div>
            </div>
            {pp.usStyleDeal && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div>
                  <label className={LABEL}>{t.listings.modal.sqft}{star("sqft")}</label>
                  <input inputMode="numeric" className={INPUT} value={form.sqft} onChange={e => set({ sqft: e.target.value })} />
                </div>
                <div>
                  <label className={LABEL}>{X.policy.properties.field.neighborhood}{star("neighborhood")}</label>
                  <input className={INPUT} value={form.neighborhood} onChange={e => set({ neighborhood: e.target.value })} />
                </div>
                <div>
                  <label className={LABEL}>MLS #</label>
                  <input className={INPUT} value={form.mlsNumber} onChange={e => set({ mlsNumber: e.target.value })} />
                </div>
              </div>
            )}
            <div>
              <span className={LABEL}>{F.amenities}</span>
              <div className="flex flex-wrap gap-2">
                {amenityOptions.map(a => {
                  const on = form.amenities.includes(a);
                  return (
                    <button key={a} type="button" aria-pressed={on}
                      onClick={() => set({ amenities: on ? form.amenities.filter(x => x !== a) : [...form.amenities, a] })}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${on ? "bg-primary/15 border-primary/40 text-primary" : "border-border text-foreground/60 hover:text-foreground"}`}>
                      {label(X.catalog.amenities as Record<string, string>, a)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm text-foreground/80">
                <input type="checkbox" checked={form.furnished} onChange={e => set({ furnished: e.target.checked })} /> {F.furnished}
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground/80" title={F.isPublicDesc}>
                <input type="checkbox" checked={form.isPublic} onChange={e => set({ isPublic: e.target.checked })} /> {F.isPublic}
              </label>
            </div>
            <div>
              <label className={LABEL}>{F.description}{star("description")}</label>
              <textarea rows={4} className={`${INPUT} resize-none`} value={form.description} onChange={e => set({ description: e.target.value })} />
            </div>
          </>)}

          {tab === "prices" && (<div className="space-y-4">
            {prices.map((p, i) => (
              <div key={p.operation} className="border border-border/60 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">{F[`op${p.operation}` as keyof typeof F]}</span>
                  {prices.length > 1 && <button type="button" onClick={() => setPrices(ps => ps.filter((_, j) => j !== i))} className="text-sm text-foreground/50 hover:text-red-500">{F.remove}</button>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className={LABEL}>{F.amount}</label>
                    <input inputMode="decimal" className={INPUT} value={p.amount} disabled={p.onRequest} onChange={e => setPrice(i, { amount: e.target.value })} placeholder={p.operation === "SALE" ? "290.000" : "25.000"} />
                  </div>
                  <div>
                    <label className={LABEL}>{F.currency}</label>
                    <select className={SELECT} value={p.currency} onChange={e => setPrice(i, { currency: e.target.value as Currency })}>
                      {CURRENCIES.map(c => <option key={c} value={c}>{(X.catalog.currencies as Record<string, string>)[c]}</option>)}
                    </select>
                  </div>
                  {p.operation !== "SALE" && (
                    <div>
                      <label className={LABEL}>{F.period}</label>
                      <select className={SELECT} value={p.period ?? "MONTH"} onChange={e => setPrice(i, { period: e.target.value as Period })}>
                        {(["MONTH", "WEEK", "NIGHT", "SEASON"] as const).map(per => <option key={per} value={per}>{F[`per${per}`]}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <label className="flex items-center gap-2 text-sm text-foreground/80">
                  <input type="checkbox" checked={p.onRequest} onChange={e => setPrice(i, { onRequest: e.target.checked, ...(e.target.checked ? { amount: "" } : {}) })} /> {F.onRequest}
                </label>
              </div>
            ))}
            {missingOps.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {missingOps.map(op => (
                  <button key={op} type="button" onClick={() => addOperation(op)} className="px-4 py-2 rounded-xl border border-dashed border-border text-sm text-foreground/70 hover:border-primary hover:text-primary">
                    + {F.addOperation}: {F[`op${op}` as keyof typeof F]}
                  </button>
                ))}
              </div>
            )}
            {prices.length === 0 && <p className="text-sm text-red-500">{F.needOperation}</p>}
          </div>)}

          {tab === "location" && (<div className="space-y-4">
            <div className="flex gap-2">
              <input className={INPUT} value={query} onChange={e => setQuery(e.target.value)} placeholder={F.search}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); search(); } }} />
              <button type="button" onClick={search} disabled={searching} className="px-5 rounded-xl border border-primary text-primary font-semibold whitespace-nowrap">
                {searching ? F.searching : F.searchBtn}
              </button>
            </div>
            {results && (results.length === 0 ? <p className="text-sm text-foreground/50">{F.noResults}</p> : (
              <ul className="border border-border/60 rounded-xl divide-y divide-border/40">
                {results.map((r, i) => (
                  <li key={i}>
                    <button type="button" className="w-full text-left px-4 py-2 text-sm hover:bg-surface-hover"
                      onClick={() => { set({ lat: r.lat, lng: r.lng, ...(r.precision === "APPROX" && form.geoPrecision === "EXACT" ? { geoPrecision: "APPROX" as GeoPrecision } : {}) }); setResults(null); }}>
                      {r.label}
                    </button>
                  </li>
                ))}
              </ul>
            ))}
            {!mapFailed
              ? <LocationPicker lat={form.lat} lng={form.lng} onChange={(lat, lng) => set({ lat, lng })} onError={() => setMapFailed(true)} />
              : <p className="text-sm text-foreground/50">{F.mapUnavailable}</p>}
            <p className="text-xs text-foreground/40">{F.pickHint}</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={LABEL}>{F.lat}</label>
                <input inputMode="decimal" className={INPUT} value={form.lat ?? ""} onChange={e => set({ lat: e.target.value === "" ? null : Number(e.target.value) })} />
              </div>
              <div>
                <label className={LABEL}>{F.lng}</label>
                <input inputMode="decimal" className={INPUT} value={form.lng ?? ""} onChange={e => set({ lng: e.target.value === "" ? null : Number(e.target.value) })} />
              </div>
              <div>
                <label className={LABEL}>{F.precision}</label>
                <select className={SELECT} value={form.geoPrecision} onChange={e => set({ geoPrecision: e.target.value as GeoPrecision })}>
                  {(["EXACT", "APPROX", "HIDDEN"] as const).map(g => <option key={g} value={g}>{F[`prec${g}`]}</option>)}
                </select>
              </div>
            </div>
            {form.lat !== null && <button type="button" onClick={() => set({ lat: null, lng: null })} className="text-sm text-foreground/50 hover:text-red-500">{F.clearPin}</button>}
          </div>)}

          <div className="flex justify-end gap-3 pt-4 border-t border-border/40">
            <button type="button" onClick={onClose} className="px-6 py-3 rounded-xl text-foreground/70 hover:text-foreground">{X.common.cancel}</button>
            <button type="submit" disabled={saving} className="px-6 py-3 rounded-xl bg-primary text-background font-semibold disabled:opacity-50">
              {saving ? X.common.loading : propertyId ? F.save : F.create}
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}
