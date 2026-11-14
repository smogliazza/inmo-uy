"use client";

import React from "react";
import { useExtra, fmt } from "@/lib/i18n/extra";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/lib/auth/AuthContext";
import { api } from "@/lib/api";
import { formatPhoneUY } from "@/lib/catalogs";
import { INPUT_CLS, SELECT_CLS, TEXTAREA_CLS, SectionHeader, SettingRow } from "./ui";

/**
 * Settings > Website (spec 8.4): the public site's home page layout, typeface, texts, content pages, notices,
 * social links, contact details and privacy policy (Organization.siteConfig, PUT /api/site-settings).
 * The WhatsApp number is an organization field (PATCH /api/settings/organization).
 */
type Config = {
  layout: "classic" | "hero" | "compact"; font: "sans" | "serif" | "modern";
  headline: string | null; subheadline: string | null; heroImageUrl: string | null;
  banners: { title: string; text: string | null; imageUrl: string | null; href: string | null }[];
  pages: { slug?: string; title: string; body: string }[];
  social: Record<string, string>; email: string | null; hours: string | null; privacyPolicy: string | null;
};
const SOCIAL = ["instagram", "facebook", "youtube", "tiktok", "linkedin", "x"] as const;
const SOCIAL_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", tiktok: "TikTok", linkedin: "LinkedIn", x: "X" };

export default function WebsiteSettings() {
  const XE = useExtra();
  const X = XE.siteSettings;
  const toast = useToast();
  const { user } = useAuth();
  const canEdit = user?.role === "FIRMADMIN" || user?.role === "SUPERADMIN";
  const [cfg, setCfg] = React.useState<Config | null>(null);
  const [whatsapp, setWhatsapp] = React.useState("");
  const [orgName, setOrgName] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [url, setUrl] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        const [s, org] = await Promise.all([api<{ config: Config; url: string | null; slug: string }>("/api/site-settings"), api<any>("/api/settings/organization")]);
        setCfg(s.config);
        setUrl(s.url || (s.slug ? `${window.location.origin}/sites/${s.slug}` : null));
        setWhatsapp(formatPhoneUY(org.whatsapp));
        setOrgName(org.name || "");
        setAddress(org.address || "");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : XE.common.error);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!cfg) return <div><SectionHeader title={X.title} description={X.desc} /><p className="text-sm text-foreground/50">{XE.common.loading}</p></div>;

  const set = (patch: Partial<Config>) => setCfg({ ...cfg, ...patch });
  const ro = !canEdit;

  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ config: Config }>("/api/site-settings", { method: "PUT", body: { config: cfg } });
      await api("/api/settings/organization", { method: "PATCH", body: { whatsapp } });
      setCfg(r.config);
      toast.success(X.saved);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : XE.common.error);
    } finally {
      setBusy(false);
    }
  };

  const template = () => fmt(XE.site.privacy.body, {
    org: orgName, email: cfg.email || XE.site.privacy.noEmail,
    address: address ? fmt(XE.site.privacy.contactAddress, { address }) : "",
  });

  return (
    <div>
      <SectionHeader title={X.title} description={X.desc} />
      {ro && <p className="text-xs text-foreground/50 mb-4">{X.readOnly}</p>}
      {url && (
        <p className="text-sm mb-6">
          {X.address}: <a href={url} target="_blank" rel="noopener" className="text-primary underline">{url}</a>
        </p>
      )}

      <fieldset disabled={ro} className="space-y-1">
        <SettingRow label={X.layout}>
          <select className={SELECT_CLS} value={cfg.layout} onChange={e => set({ layout: e.target.value as Config["layout"] })}>
            {(["classic", "hero", "compact"] as const).map(k => <option key={k} value={k}>{X.layouts[k]}</option>)}
          </select>
        </SettingRow>
        <SettingRow label={X.font}>
          <select className={SELECT_CLS} value={cfg.font} onChange={e => set({ font: e.target.value as Config["font"] })}>
            {(["sans", "serif", "modern"] as const).map(k => <option key={k} value={k}>{X.fonts[k]}</option>)}
          </select>
        </SettingRow>
        <SettingRow label={X.headline}>
          <input className={INPUT_CLS} style={{ width: 280 }} value={cfg.headline ?? ""} placeholder={X.headlinePh} onChange={e => set({ headline: e.target.value })} />
        </SettingRow>
        <SettingRow label={X.subheadline}>
          <input className={INPUT_CLS} style={{ width: 280 }} value={cfg.subheadline ?? ""} onChange={e => set({ subheadline: e.target.value })} />
        </SettingRow>
        <SettingRow label={X.heroImage}>
          <input className={INPUT_CLS} style={{ width: 280 }} value={cfg.heroImageUrl ?? ""} placeholder="https://" onChange={e => set({ heroImageUrl: e.target.value })} />
        </SettingRow>
        <SettingRow label={X.whatsapp} description={X.whatsappHelp}>
          <input className={INPUT_CLS} style={{ width: 200 }} value={whatsapp} placeholder={XE.labels.phonePlaceholder} onChange={e => setWhatsapp(e.target.value)} />
        </SettingRow>
        <SettingRow label={X.email}>
          <input className={INPUT_CLS} style={{ width: 240 }} type="email" value={cfg.email ?? ""} onChange={e => set({ email: e.target.value })} />
        </SettingRow>
        <SettingRow label={X.hours}>
          <input className={INPUT_CLS} style={{ width: 280 }} value={cfg.hours ?? ""} placeholder={X.hoursPh} onChange={e => set({ hours: e.target.value })} />
        </SettingRow>

        <h3 className="text-sm font-semibold text-foreground pt-6">{X.social}</h3>
        {SOCIAL.map(k => (
          <SettingRow key={k} label={SOCIAL_LABEL[k]}>
            <input className={INPUT_CLS} style={{ width: 280 }} value={cfg.social[k] ?? ""} placeholder="https://"
              onChange={e => set({ social: { ...cfg.social, [k]: e.target.value } })} />
          </SettingRow>
        ))}

        <h3 className="text-sm font-semibold text-foreground pt-6">{X.pages}</h3>
        <p className="text-xs text-foreground/50 mb-2">{X.pagesHelp}</p>
        {cfg.pages.map((p, i) => (
          <div key={i} className="border border-border/60 rounded-lg p-3 mb-3 space-y-2">
            <div className="flex gap-2">
              <input className={`${INPUT_CLS} flex-1`} aria-label={X.pageTitle} placeholder={X.pageTitle} value={p.title}
                onChange={e => set({ pages: cfg.pages.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} />
              <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => set({ pages: cfg.pages.filter((_, k) => k !== i) })}>{X.removePage}</button>
            </div>
            <textarea className={`${TEXTAREA_CLS} w-full`} rows={5} aria-label={X.pageBody} placeholder={X.pageBody} value={p.body}
              onChange={e => set({ pages: cfg.pages.map((x, k) => (k === i ? { ...x, body: e.target.value } : x)) })} />
          </div>
        ))}
        {cfg.pages.length < 10 && (
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => set({ pages: [...cfg.pages, { title: "", body: "" }] })}>+ {X.addPage}</button>
        )}

        <h3 className="text-sm font-semibold text-foreground pt-6">{X.banners}</h3>
        {cfg.banners.map((b, i) => (
          <div key={i} className="border border-border/60 rounded-lg p-3 mb-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            {(["title", "text", "href", "imageUrl"] as const).map(f => (
              <input key={f} className={INPUT_CLS} aria-label={X[f === "title" ? "bannerTitle" : f === "text" ? "bannerText" : f === "href" ? "bannerLink" : "bannerImage"]}
                placeholder={X[f === "title" ? "bannerTitle" : f === "text" ? "bannerText" : f === "href" ? "bannerLink" : "bannerImage"]}
                value={b[f] ?? ""} onChange={e => set({ banners: cfg.banners.map((x, k) => (k === i ? { ...x, [f]: e.target.value } : x)) })} />
            ))}
            <button type="button" className="text-xs text-red-400 hover:underline text-left" onClick={() => set({ banners: cfg.banners.filter((_, k) => k !== i) })}>{X.removePage}</button>
          </div>
        ))}
        {cfg.banners.length < 6 && (
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => set({ banners: [...cfg.banners, { title: "", text: null, imageUrl: null, href: null }] })}>+ {X.addBanner}</button>
        )}

        <h3 className="text-sm font-semibold text-foreground pt-6">{X.privacy}</h3>
        <p className="text-xs text-foreground/50 mb-2">{X.privacyHelp}</p>
        <textarea className={`${TEXTAREA_CLS} w-full`} rows={8} value={cfg.privacyPolicy ?? ""} onChange={e => set({ privacyPolicy: e.target.value })} />
        {!cfg.privacyPolicy && (
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => set({ privacyPolicy: template() })}>{X.privacyUseTemplate}</button>
        )}
      </fieldset>

      {canEdit && (
        <div className="mt-6">
          <button type="button" disabled={busy} onClick={save} className="px-4 py-2 bg-primary text-background rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60">{X.save}</button>
        </div>
      )}
    </div>
  );
}
