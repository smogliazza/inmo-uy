"use client";

import React, { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/I18nContext";
import { useExtra } from "@/lib/i18n/extra";
import { useSettings } from "@/lib/settings/useSettings";
import { useAuth } from "@/lib/auth/AuthContext";
import { useToast } from "@/components/ui/Toast";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { fmtLocale } from "@/lib/format";

export default function FinancePage() {
  const { t } = useI18n();
  const X = useExtra();
  const { preferences } = useSettings();
  const FX = X.financeExtra;
  const { token } = useAuth();
  const toast = useToast();

  const [metrics, setMetrics] = useState<any>(null);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestingPayout, setRequestingPayout] = useState(false);
  const [projections, setProjections] = useState<any[]>([]);
  const [selectedCommIndex, setSelectedCommIndex] = useState(0);
  const [tierErrors, setTierErrors] = useState<{ commissions?: string; projections?: string }>({});
  const { user } = useAuth();

  const isCore = user?.tier === "CORE";
  const isPro = user?.tier === "PRO";
  const isElite = user?.tier === "ELITE";

  // Payout approval queue (management only)
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const isApprover = ["SUPERADMIN", "FIRMADMIN", "MANAGER"].includes(user?.role || "");
  const [payoutRequests, setPayoutRequests] = useState<any[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !isApprover) return;
    fetch(`${API_BASE}/api/finance/payout-requests`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setPayoutRequests(Array.isArray(d) ? d : []))
      .catch(() => setPayoutRequests([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isApprover]);

  const reviewPayout = async (id: string, decision: "approve" | "reject") => {
    if (!token) return;
    setReviewingId(id);
    try {
      const res = await fetch(`${API_BASE}/api/finance/commissions/${id}/${decision}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok || res.status === 409) {
        // 409 = already processed by another reviewer; either way it leaves the queue
        setPayoutRequests((prev) => prev.filter((r) => r.id !== id));
        if (res.ok) toast.success(decision === "approve" ? FX.payoutApproved : FX.payoutReturned);
        else toast.info(d.error || FX.alreadyProcessed);
      } else {
        toast.error(d.error || FX.updateFailed);
      }
    } catch {
      toast.error(t.login.serverError);
    } finally {
      setReviewingId(null);
    }
  };

  // Client-side CSV of the commissions currently loaded
  const exportCommissionsCsv = () => {
    if (!commissions.length) { toast.info(FX.noCommissionsExport); return; }
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Property", "Gross", "Firm Split %", "Override %", "Net Payout", "Status", "Paid At", "Created"];
    const rows = commissions.map((c) => [
      c.transaction?.property?.address, c.grossAmount, c.firmSplitPercent, c.overridePercent,
      c.netPayout, c.status, c.paidAt ? new Date(c.paidAt).toISOString().slice(0, 10) : "",
      new Date(c.createdAt).toISOString().slice(0, 10),
    ].map(esc).join(","));
    const blob = new Blob([[header.map(esc).join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `commissions-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!token) return;

    const fetchFinanceData = async () => {
      setLoading(true);
      try {
        const [metricsRes, commsRes, projRes] = await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/finance/metrics`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/finance/commissions`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/finance/projections`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        // Only 401 (invalid/expired token) ends the session. /commissions and
        // /projections return 403 for plan gating (requireTier) — that is an
        // upgrade prompt, handled below, not a reason to log the user out.
        if (
          metricsRes.status === 401 ||
          commsRes.status === 401 ||
          projRes.status === 401
        ) {
          localStorage.removeItem("token");
          localStorage.removeItem("user");
          window.location.href = "/login";
          return;
        }

        if (metricsRes.ok) {
          const metricsData = await metricsRes.json();
          setMetrics(metricsData);
        }

        if (commsRes.ok) {
          const commsData = await commsRes.json();
          setCommissions(commsData.data || []);
        } else if (commsRes.status === 403) {
          const err = await commsRes.json();
          setTierErrors(prev => ({ ...prev, commissions: err.error }));
        }

        if (projRes.ok) {
          const projData = await projRes.json();
          setProjections(projData);
        } else if (projRes.status === 403) {
          const err = await projRes.json();
          setTierErrors(prev => ({ ...prev, projections: err.error }));
        }
      } catch (error) {
        console.error("Failed to fetch finance data", error);
      } finally {
        setLoading(false);
      }
    };

    fetchFinanceData();
  }, [token]);

  const handleRequestPayout = async (commissionId: string) => {
    if (!token) return;
    setRequestingPayout(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/finance/commissions/${commissionId}/payout`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (res.ok) {
        // Server returns the updated commission — now REQUESTED, pending admin approval
        const updated = await res.json();
        setCommissions((prev) =>
          prev.map((c) =>
            c.id === commissionId
              ? { ...c, status: updated.status, paidAt: updated.paidAt }
              : c,
          ),
        );
      } else {
        const err = await res.json();
        toast.error(err.error || (t.finance as any).payoutFail);
      }
    } catch (error) {
      console.error("Request Payout Error", error);
      toast.error((t.finance as any).payoutFail);
    } finally {
      setRequestingPayout(false);
    }
  };

  if (loading) {
    return (
      <div className="p-24 text-center font-sans text-sm uppercase tracking-widest text-foreground/50 bg-background h-screen flex flex-col items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mb-6" />
        {FX.loading}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out text-foreground pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 pb-6 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t.finance.title}
          </h1>
          <p className="text-foreground/50 mt-1 text-sm">
            {t.finance.subtitle}
          </p>
        </div>
        <button onClick={exportCommissionsCsv} className="px-6 py-2.5 bg-surface text-foreground hover:bg-background ring-1 ring-border/50 transition-colors duration-300 rounded-xl text-base font-semibold shadow-sm w-full md:w-auto text-center">
          {t.finance.exportReport}
        </button>
      </div>

      {/* Payout approval queue — visible to management only */}
      {isApprover && (
        <div className="bg-background ring-1 ring-border/50 rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-sans text-lg font-semibold text-foreground">
              {FX.approvalQueue}
            </h2>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary">
              {payoutRequests.length} {FX.pending}
            </span>
          </div>
          {payoutRequests.length === 0 ? (
            <p className="text-sm text-foreground/50">{FX.noPendingPayouts}</p>
          ) : (
            <div className="divide-y divide-border/50">
              {payoutRequests.map((r) => {
                // The server decides (own request is blocked unless you are the only approver)
                const isOwn = r.canReview === false;
                return (
                  <div key={r.id} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">
                        {r.agent?.name || r.agent?.email} · ${Number(r.netPayout).toLocaleString(fmtLocale())}
                      </div>
                      <div className="text-xs text-foreground/50 truncate">
                        {r.transaction?.property?.address || "—"} · Gross ${Number(r.grossAmount).toLocaleString(fmtLocale())} · Firm {r.firmSplitPercent}%
                      </div>
                    </div>
                    {isOwn ? (
                      <span className="text-xs text-foreground/40 italic">{FX.ownRequest}</span>
                    ) : (
                      <div className="flex gap-2 shrink-0">
                        <button
                          disabled={reviewingId === r.id}
                          onClick={() => reviewPayout(r.id, "reject")}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold ring-1 ring-border text-foreground/70 hover:bg-surface disabled:opacity-50"
                        >
                          {FX.reject}
                        </button>
                        <button
                          disabled={reviewingId === r.id}
                          onClick={() => reviewPayout(r.id, "approve")}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-background hover:opacity-90 disabled:opacity-50"
                        >
                          {reviewingId === r.id ? "…" : FX.approve}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Commission Waterfall */}
        <div className="bg-background ring-1 ring-border/50 rounded-2xl shadow-sm p-8 flex flex-col relative overflow-hidden">
          {tierErrors.commissions && (
            <div className="absolute inset-0 z-20 bg-background/60 backdrop-blur-[2px] flex flex-col items-center justify-center p-8 text-center">
              <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                <span className="text-2xl">🔒</span>
              </div>
              <h3 className="text-lg font-bold mb-2">{t.finance.waterfall}</h3>
              <p className="text-base text-foreground/60 mb-6 max-w-xs">
                {tierErrors.commissions}
              </p>
              <button className="px-6 py-2 bg-primary text-background rounded-xl text-base font-bold shadow-lg hover:scale-105 transition-transform">
                {FX.upgradePro}
              </button>
            </div>
          )}
          <h2 className="font-sans text-2xl font-semibold text-foreground mb-8 pb-6 border-b border-border/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            {t.finance.waterfall}
            {commissions.length > 0 && (
              <div className="flex items-center gap-2">
                <select 
                  value={selectedCommIndex}
                  onChange={(e) => setSelectedCommIndex(parseInt(e.target.value))}
                  className="text-sm font-sans font-semibold text-primary ring-1 ring-primary/30 px-3 py-1 bg-primary/5 rounded-md outline-none cursor-pointer"
                >
                  {commissions.map((c, idx) => (
                    <option key={c.id} value={idx}>
                      {FX.dealPrefix}: {c.transaction.property.address.split(',')[0]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </h2>

          {commissions.length === 0 ? (
            <div className="text-center py-16 text-foreground/50 font-sans text-base font-semibold">
              {tierErrors.commissions ? FX.lockedDesc : FX.noCommissions}
            </div>
          ) : (
            <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-[1px] before:bg-border/50 pb-12">
              {/* Step 1: Gross */}
              <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                <div className="flex items-center justify-center w-10 h-10 ring-1 ring-border/60 bg-surface text-foreground font-sans font-bold text-lg shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 rounded-full z-10 transition-colors group-hover:ring-primary group-hover:text-primary shadow-sm">
                  1
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-surface/30 p-6 ring-1 ring-border/50 rounded-xl transition-all duration-300 group-hover:ring-primary/50 group-hover:shadow-md">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold font-sans text-foreground/60 uppercase tracking-widest">
                      {t.finance.grossCommission}
                    </span>
                    <span className="text-xl font-sans font-semibold text-foreground">
                      ${commissions[selectedCommIndex].grossAmount.toLocaleString(fmtLocale())}
                    </span>
                  </div>
                  <div className="text-xs font-sans text-foreground/50 mt-3 font-semibold border-t border-border/40 pt-3">
                    {t.finance.recvFromTitle}
                  </div>
                </div>
              </div>

              {/* Step 2: Firm Split */}
              <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group opacity-80 hover:opacity-100 transition-opacity">
                <div className="flex items-center justify-center w-10 h-10 ring-1 ring-border/60 bg-surface/50 text-foreground/60 font-sans font-bold text-lg shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 rounded-full z-10 shadow-sm">
                  -
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-surface/10 p-6 ring-1 ring-border/40 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold font-sans text-foreground/60">
                      {t.finance.firmSplit} ({commissions[selectedCommIndex].firmSplitPercent}%)
                    </span>
                    <span className="text-lg font-sans font-medium text-foreground/60">
                      -$
                      {(
                        commissions[selectedCommIndex].grossAmount *
                        (commissions[selectedCommIndex].firmSplitPercent / 100)
                      ).toLocaleString(fmtLocale())}
                    </span>
                  </div>
                </div>
              </div>

              {/* Step 3: Team Override */}
              {commissions[selectedCommIndex].overridePercent > 0 && (
                <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group opacity-80 hover:opacity-100 transition-opacity">
                  <div className="flex items-center justify-center w-10 h-10 ring-1 ring-border/60 bg-surface/50 text-foreground/60 font-sans font-bold text-lg shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 rounded-full z-10 shadow-sm">
                    -
                  </div>
                  <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-surface/10 p-6 ring-1 ring-border/40 rounded-xl">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold font-sans text-foreground/60">
                        {t.finance.teamOverride} (
                        {commissions[selectedCommIndex].overridePercent}%)
                      </span>
                      <span className="text-lg font-sans font-medium text-foreground/60">
                        -$
                        {(
                          commissions[selectedCommIndex].grossAmount *
                          (commissions[selectedCommIndex].overridePercent / 100)
                        ).toLocaleString(fmtLocale())}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Net Payout */}
              <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group pt-8">
                <div className="flex items-center justify-center w-12 h-12 ring-2 ring-primary/50 bg-primary/10 text-primary font-sans font-bold text-2xl shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 rounded-full z-10 relative shadow-sm">
                  <div className="absolute inset-0 bg-primary/20 animate-ping opacity-20 rounded-full"></div>
                  =
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-primary/5 p-8 ring-1 ring-primary/30 rounded-2xl relative shadow-md">
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-bold font-sans text-primary/80 uppercase tracking-widest">
                      {t.finance.netPayout}
                    </span>
                    <span className="text-4xl lg:text-5xl font-sans font-bold tracking-tight text-primary">
                      ${commissions[selectedCommIndex].netPayout.toLocaleString(fmtLocale())}
                    </span>
                  </div>
                  <div className="text-xs font-sans font-semibold uppercase text-primary/70 mt-6 border-t border-primary/20 pt-4 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${commissions[selectedCommIndex].status === "PAID" ? "bg-primary shadow-[0_0_8px_rgba(var(--primary),0.5)]" : "bg-primary/30"} flex-shrink-0`}
                      />
                      {commissions[selectedCommIndex].status === "PAID"
                        ? `${t.finance.paidOn} ${new Date(commissions[selectedCommIndex].paidAt).toLocaleDateString(fmtLocale())}`
                        : commissions[selectedCommIndex].status === "REQUESTED"
                        ? ((t.finance as any).payoutRequested || "Payout requested — awaiting approval")
                        : t.finance.pendingSettlement}
                    </div>
                    {commissions[selectedCommIndex].status !== "PAID" && commissions[selectedCommIndex].status !== "REQUESTED" && (
                      <button
                        onClick={() => handleRequestPayout(commissions[selectedCommIndex].id)}
                        disabled={requestingPayout}
                        className="px-4 py-2 ring-1 ring-primary/50 rounded-lg text-primary hover:bg-primary hover:text-background transition-colors disabled:opacity-50"
                      >
                        {requestingPayout ? "..." : t.finance.requestPayout}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Firm Performance */}
        <div className="bg-background ring-1 ring-border/50 rounded-2xl shadow-sm p-8 flex flex-col h-full">
          <h2 className="font-sans text-2xl font-semibold text-foreground mb-8 pb-6 border-b border-border/40 flex items-center justify-between">
            {t.finance.performance}
            <span className="text-sm font-semibold text-foreground/70 ring-1 ring-border/50 px-3 py-1.5 bg-surface/50 rounded-md">
              {FX.proTier}
            </span>
          </h2>

          <div className="flex flex-col gap-2 mb-10 border-b border-border/40 pb-8">
            <p className="font-sans text-base font-semibold text-foreground/50">
              {t.finance.ytdGross}
            </p>
            <div className="flex flex-col sm:flex-row sm:items-end gap-2 sm:gap-4 mt-2">
              <p className="font-sans tracking-tight text-5xl font-bold text-foreground">
                ${metrics?.ytdGross?.toLocaleString(fmtLocale()) || 0}
              </p>
              <div className="pb-1.5 text-primary font-sans text-base font-semibold">
                + {metrics?.topPercent || t.finance.topPercent}
              </div>
            </div>
          </div>

          <div className="space-y-3 flex-1">
            {preferences.finance.showLeaderboard && metrics?.leaderboard?.map((leader: any) => (
              <div
                key={leader.name}
                className={`w-full ${leader.name === metrics?.userRank?.name ? "bg-primary/5 ring-2 ring-primary/50 shadow-md transform scale-[1.02]" : "bg-surface/30 ring-1 ring-border/40 hover:shadow-sm hover:ring-border/80"} p-5 rounded-xl flex justify-between items-center transition-all duration-300`}
              >
                <div className="flex items-center gap-5 relative">
                  {leader.name === metrics?.userRank?.name && (
                    <div className="absolute -left-5 w-[3px] h-8 bg-primary rounded-r-md" />
                  )}
                  <div
                    className={`w-10 h-10 flex items-center justify-center font-sans font-bold text-base rounded-full ${leader.name === metrics?.userRank?.name ? "bg-primary text-background shadow-[0_0_10px_rgba(var(--primary),0.4)]" : "ring-1 ring-border/80 bg-surface text-foreground/60 shadow-sm"}`}
                  >
                    {leader.rank}
                  </div>
                  <span
                    className={`font-sans text-base ${leader.name === metrics?.userRank?.name ? "text-primary font-bold" : "text-foreground font-medium"}`}
                  >
                    {leader.name === metrics?.userRank?.name
                      ? FX.you
                      : leader.name}
                  </span>
                </div>
                <span
                  className={`font-sans text-xl font-semibold ${leader.name === metrics?.userRank?.name ? "text-primary" : "text-foreground/80"}`}
                >
                  {leader.gross == null ? "—" : `$${leader.gross.toLocaleString(fmtLocale())}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Revenue Projection Line Chart */}
      <div className="bg-background ring-1 ring-border/50 rounded-2xl shadow-sm p-8 relative overflow-hidden">
        {tierErrors.projections && (
          <div className="absolute inset-0 z-20 bg-background/60 backdrop-blur-[2px] flex flex-col items-center justify-center p-8 text-center">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <span className="text-2xl">📈</span>
            </div>
            <h3 className="text-lg font-bold mb-2">{t.finance.projectionsTitle}</h3>
            <p className="text-base text-foreground/60 mb-6 max-w-xs">
              {tierErrors.projections}
            </p>
            <button className="px-6 py-2 bg-primary text-background rounded-xl text-base font-bold shadow-lg hover:scale-105 transition-transform">
              {FX.upgradeElite}
            </button>
          </div>
        )}
        <div className="mb-8">
          <h2 className="font-sans text-2xl font-semibold text-foreground">
            {t.finance.projectionsTitle}
          </h2>
          <p className="font-sans text-base text-foreground/50 mt-1">
            {t.finance.projectionsSubtitle}
          </p>
        </div>
        <div className="h-[350px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={projections} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.5} />
              <XAxis 
                dataKey="month" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: "var(--foreground)", fontSize: 12, opacity: 0.6 }}
                dy={10}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: "var(--foreground)", fontSize: 12, opacity: 0.6 }}
                tickFormatter={(value) => `$${value / 1000}k`}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: "var(--surface)", 
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                  fontSize: "12px",
                  fontWeight: "semibold"
                }}
                formatter={(value: any) => [`$${value.toLocaleString(fmtLocale())}`, (t.finance as any).estimatedRevenue ?? "Estimated Revenue"]}
              />
              <Area 
                type="monotone" 
                dataKey="amount" 
                stroke="var(--primary)" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorAmount)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
