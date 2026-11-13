"use client";

import { useCallback, useEffect, useState } from "react";
import { useModules } from "@/lib/modules";
import { useI18n } from "@/lib/i18n/I18nContext";
import { useExtra } from "@/lib/i18n/extra";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/lib/auth/AuthContext";
import { api } from "@/lib/api";
import { fmtLocale } from "@/lib/format";

const INPUT = "w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:border-primary outline-none";
const BTN = "px-4 py-2 bg-primary text-background hover:opacity-90 transition-opacity rounded-lg text-sm font-semibold shadow-sm disabled:opacity-50";

export default function ServicesPage() {
  const { t } = useI18n();
  const X = useExtra();
  const toast = useToast();
  const { user } = useAuth() as any;

  const [clients, setClients] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [gifts, setGifts] = useState<any[]>([]);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [gift, setGift] = useState({ clientId: "", item: "", amount: "" });
  const [ref, setRef] = useState({ refereeId: "", notes: "", feeAmount: "" });
  const [busy, setBusy] = useState(false);
  // Each card belongs to its own module (gifts / referrals); the page shows when either is on
  const { isOn } = useModules();
  const giftsOn = isOn("gifts");
  const referralsOn = isOn("referrals");

  const load = useCallback(() => {
    if (giftsOn) api("/api/clients?limit=100").then((d) => setClients(d.data || [])).catch(() => {});
    if (referralsOn) api("/api/settings/team").then(setTeam).catch(() => {});
    if (giftsOn) api("/api/gifts").then(setGifts).catch(() => {});
    if (referralsOn) api("/api/referrals").then(setReferrals).catch(() => {});
  }, [giftsOn, referralsOn]);
  useEffect(load, [load]);

  const orderGift = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/gifts", { method: "POST", body: { ...gift, amount: gift.amount || undefined } });
      toast.success(X.services.giftOrdered);
      setGift({ clientId: "", item: "", amount: "" });
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : X.common.error);
    } finally {
      setBusy(false);
    }
  };

  const sendReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/referrals", { method: "POST", body: { ...ref, feeAmount: ref.feeAmount || undefined } });
      toast.success(X.services.referralSent);
      setRef({ refereeId: "", notes: "", feeAmount: "" });
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : X.common.error);
    } finally {
      setBusy(false);
    }
  };

  const updateGift = async (id: string, status: string) => {
    try { await api(`/api/gifts/${id}`, { method: "PATCH", body: { status } }); load(); }
    catch (err) { toast.error(err instanceof Error ? err.message : X.common.error); }
  };
  const updateReferral = async (id: string, status: string) => {
    try { await api(`/api/referrals/${id}`, { method: "PATCH", body: { status } }); load(); }
    catch (err) { toast.error(err instanceof Error ? err.message : X.common.error); }
  };

  const colleagues = team.filter((m) => m.id !== user?.id);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out text-foreground pb-12">
      <div className="pb-6 border-b border-border">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t.services.title}</h1>
        <p className="text-foreground/50 mt-1 text-sm">{t.services.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Client gifts */}
        {giftsOn && <div className="bg-background border border-border rounded-xl p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">🍾 {t.services.loyaltyTitle}</h2>
            <p className="text-sm text-foreground/50 mt-1">{t.services.loyaltyDesc}</p>
          </div>
          <form onSubmit={orderGift} className="space-y-3">
            <select required value={gift.clientId} onChange={(e) => setGift({ ...gift, clientId: e.target.value })} className={INPUT}>
              <option value="">{X.services.chooseClient}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
            </select>
            <div className="grid grid-cols-3 gap-3">
              <input required value={gift.item} onChange={(e) => setGift({ ...gift, item: e.target.value })} placeholder={X.services.giftPlaceholder} className={`${INPUT} col-span-2`} />
              <input type="number" min="0" value={gift.amount} onChange={(e) => setGift({ ...gift, amount: e.target.value })} placeholder={X.services.amount} className={INPUT} />
            </div>
            <button disabled={busy} className={BTN}>{X.services.sendGift}</button>
          </form>
          <div>
            <h3 className="text-sm font-semibold text-foreground/60 mb-2">{X.services.myGifts}</h3>
            {gifts.length === 0 ? (
              <p className="text-sm text-foreground/40">{X.services.empty}</p>
            ) : (
              <ul className="divide-y divide-border/50">
                {gifts.map((g) => (
                  <li key={g.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                    <div>
                      <div className="font-medium">{g.item}</div>
                      <div className="text-foreground/50 text-xs">{g.client?.firstName} {g.client?.lastName} · {new Date(g.createdAt).toLocaleDateString(fmtLocale())}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-surface border border-border">{g.status}</span>
                      {g.status !== "DELIVERED" && g.status !== "CANCELLED" && (
                        <button onClick={() => updateGift(g.id, "DELIVERED")} className="text-xs text-primary hover:underline">{X.services.markDelivered}</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>}

        {/* Colleague referrals */}
        {referralsOn && <div className="bg-background border border-border rounded-xl p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">🤝 {X.services.myReferrals}</h2>
            <p className="text-sm text-foreground/50 mt-1">{t.services.directoryTitle}</p>
          </div>
          <form onSubmit={sendReferral} className="space-y-3">
            <select required value={ref.refereeId} onChange={(e) => setRef({ ...ref, refereeId: e.target.value })} className={INPUT}>
              <option value="">{X.services.chooseAgent}</option>
              {colleagues.map((m) => <option key={m.id} value={m.id}>{m.name}{m.title ? ` — ${m.title}` : ""}</option>)}
            </select>
            <textarea value={ref.notes} onChange={(e) => setRef({ ...ref, notes: e.target.value })} placeholder={X.services.referralNotes} rows={2} className={`${INPUT} resize-none`} />
            <input type="number" min="0" value={ref.feeAmount} onChange={(e) => setRef({ ...ref, feeAmount: e.target.value })} placeholder={`${X.publicListing.referralFee} — ${X.common.optional}`} className={INPUT} />
            <button disabled={busy || colleagues.length === 0} className={BTN}>{X.services.sendReferral}</button>
          </form>
          {referrals.length === 0 ? (
            <p className="text-sm text-foreground/40">{X.services.empty}</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {referrals.map((r) => (
                <li key={r.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <div>
                    <div className="font-medium">{r.referrer?.name} → {r.referee?.name}</div>
                    {r.notes && <div className="text-foreground/50 text-xs">{r.notes}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded bg-surface border border-border">{r.status}</span>
                    {r.status === "PENDING" && r.referee?.id === user?.id && (
                      <>
                        <button onClick={() => updateReferral(r.id, "ACCEPTED")} className="text-xs text-primary hover:underline">{X.services.accept}</button>
                        <button onClick={() => updateReferral(r.id, "DECLINED")} className="text-xs text-foreground/50 hover:underline">{X.services.decline}</button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>}
      </div>
    </div>
  );
}
