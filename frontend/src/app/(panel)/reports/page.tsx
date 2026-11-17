"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
    BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useI18n } from "@/lib/i18n/I18nContext";
import { fmtLocale } from "@/lib/format";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const token = () => (typeof window !== "undefined" ? localStorage.getItem("token") || "" : "");

const fmtCurrency = (n: number) =>
    n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${(n / 1000).toFixed(0)}K`;

const COLORS = ["#B8977E", "#4F7DF3", "#7C5CFC", "#10B981", "#F59E0B", "#EF4444"];
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

interface DashData {
    activeListings: number;
    newLeads: number;
    pendingOffers: number;
    ytdCommission: number;
    monthlyData: { month: string; deals: number; commission: number }[];
    pipeline: { stage: string; count: number }[];
    topItems: any[];
}

interface FinanceMetrics {
    ytdGross: number;
    ytdNet: number;
    leaderboard: { agent: string; ytd: number }[];
    monthlyCommissions: { month: string; gross: number; net: number }[];
}

export default function ReportsPage() {
    const { t } = useI18n();
    const T = (t as any).reports ?? {};
    const Tpipe = (t as any).pipeline ?? {};

    const [dashData,    setDashData]    = useState<DashData | null>(null);
    const [finMetrics,  setFinMetrics]  = useState<FinanceMetrics | null>(null);
    const [loading,     setLoading]     = useState(true);
    const [activeTab,   setActiveTab]   = useState("overview");

    const TABS = [
        { key: "overview",    label: T.tabs?.overview },
        { key: "commissions", label: T.tabs?.commissions },
        { key: "pipeline",    label: T.tabs?.pipeline },
        { key: "leaderboard", label: T.tabs?.leaderboard },
    ];

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const headers = { Authorization: `Bearer ${token()}` };
            const [dashRes, finRes] = await Promise.all([
                fetch(`${API}/api/dashboard`, { headers }),
                fetch(`${API}/api/finance/metrics`, { headers }),
            ]);
            if (dashRes.ok) setDashData(await dashRes.json());
            if (finRes.ok)  setFinMetrics(await finRes.json());
        } catch {}
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const monthlyChart = dashData?.monthlyData || MONTH_NAMES.slice(0, 6).map((m) => ({
        month: m,
        deals: 0,
        commission: 0,
    }));

    const pipelineData = dashData?.pipeline || [
        { stage: Tpipe.columns?.OFFER_REVIEW,    count: 0 },
        { stage: Tpipe.columns?.IN_CONTRACT,     count: 0 },
        { stage: Tpipe.columns?.BOARD_PACKAGE,   count: 0 },
        { stage: Tpipe.columns?.CLEARED_TO_CLOSE, count: 0 },
        { stage: Tpipe.columns?.CLOSED,          count: 0 },
    ];

    const leaderboard = finMetrics?.leaderboard || [];

    const exportCSV = () => {
        const agentLabel = T.leaderboard?.agent;
        const ytdLabel   = T.leaderboard?.ytdGross;
        const rows = [[agentLabel, ytdLabel]];
        leaderboard.forEach(r => rows.push([r.agent, `$${r.ytd.toLocaleString(fmtLocale())}`]));
        const csv = rows.map(r => r.join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `re-crm-report-${new Date().toISOString().substring(0,10)}.csv`;
        a.click();
    };

    return (
        <div className="max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">{T.title}</h1>
                    <p className="text-sm text-foreground/50 mt-0.5">{T.subtitle}</p>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={exportCSV}
                        className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-lg text-sm text-foreground/60 hover:bg-surface-hover transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        {T.exportCsv}
                    </button>
                </div>
            </div>

            {/* KPI Cards */}
            {loading ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="bg-surface border border-border rounded-xl p-5 animate-pulse h-24" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    {[
                        { label: T.kpi?.activeListings, value: dashData?.activeListings ?? 0,                        fmt: (v: number) => v.toString() },
                        { label: T.kpi?.newLeads,       value: dashData?.newLeads ?? 0,                              fmt: (v: number) => v.toString() },
                        { label: T.kpi?.pendingOffers,  value: dashData?.pendingOffers ?? 0,                         fmt: (v: number) => v.toString() },
                        { label: T.kpi?.ytdCommission,  value: finMetrics?.ytdGross ?? dashData?.ytdCommission ?? 0,  fmt: fmtCurrency },
                    ].map(kpi => (
                        <div key={kpi.label} className="bg-surface border border-border rounded-xl p-5">
                            <div className="text-xs text-foreground/40 uppercase tracking-widest mb-2">{kpi.label}</div>
                            <div className="text-2xl font-bold text-foreground">{kpi.fmt(kpi.value)}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Tab navigation */}
            <div className="flex border-b border-border mb-6 overflow-x-auto">
                {TABS.map(tab => (
                    <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                        className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap flex-shrink-0 ${
                            activeTab === tab.key
                                ? "border-primary text-primary"
                                : "border-transparent text-foreground/50 hover:text-foreground"
                        }`}>
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Overview tab */}
            {activeTab === "overview" && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-surface border border-border rounded-xl p-6">
                        <h3 className="text-sm font-semibold text-foreground mb-4">{T.charts?.monthlyDeals}</h3>
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={monthlyChart} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-foreground)", opacity: 0.5 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 11, fill: "var(--color-foreground)", opacity: 0.5 }} axisLine={false} tickLine={false} />
                                <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                                <Bar dataKey="deals" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="bg-surface border border-border rounded-xl p-6">
                        <h3 className="text-sm font-semibold text-foreground mb-4">{T.charts?.monthlyCommission}</h3>
                        <ResponsiveContainer width="100%" height={220}>
                            <LineChart data={monthlyChart} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-foreground)", opacity: 0.5 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 11, fill: "var(--color-foreground)", opacity: 0.5 }} axisLine={false} tickLine={false}
                                    tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                                <Tooltip formatter={(v) => fmtCurrency(Number(Array.isArray(v) ? v[0] : (v ?? 0)))} contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                                <Line type="monotone" dataKey="commission" stroke="var(--color-primary)" strokeWidth={2.5} dot={{ fill: "var(--color-primary)", r: 4 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="bg-surface border border-border rounded-xl p-6">
                        <h3 className="text-sm font-semibold text-foreground mb-4">{T.charts?.pipelineDistribution}</h3>
                        <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                                <Pie data={pipelineData} dataKey="count" nameKey="stage" cx="50%" cy="50%" outerRadius={80} label={(props) => `${(props as unknown as Record<string,unknown>).stage} ${((Number(props.percent) || 0) * 100).toFixed(0)}%`}>
                                    {pipelineData.map((_, i) => (
                                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="bg-surface border border-border rounded-xl p-6">
                        <h3 className="text-sm font-semibold text-foreground mb-4">{T.charts?.leadSource}</h3>
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart layout="vertical"
                                data={[
                                    { source: "Referral",    count: 42 },
                                    { source: "StreetEasy",  count: 31 },
                                    { source: "Zillow",      count: 24 },
                                    { source: "Website",     count: 18 },
                                    { source: "Cold Call",   count: 11 },
                                    { source: "Open House",  count: 9 },
                                ]}
                                margin={{ top: 0, right: 20, bottom: 0, left: 60 }}>
                                <XAxis type="number" tick={{ fontSize: 11, fill: "var(--color-foreground)", opacity: 0.5 }} axisLine={false} tickLine={false} />
                                <YAxis dataKey="source" type="category" tick={{ fontSize: 11, fill: "var(--color-foreground)", opacity: 0.5 }} axisLine={false} tickLine={false} />
                                <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                                <Bar dataKey="count" fill="var(--color-primary)" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* Commissions tab */}
            {activeTab === "commissions" && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {[
                            { label: T.commission?.ytdGross,   value: finMetrics?.ytdGross  ?? 0, color: "text-foreground" },
                            { label: T.commission?.ytdNet,     value: finMetrics?.ytdNet    ?? 0, color: "text-green-500" },
                            { label: T.commission?.avgPerDeal, value: (finMetrics?.ytdGross ?? 0) / Math.max(1, monthlyChart.reduce((s,m)=>s+m.deals,0)), color: "text-primary" },
                        ].map(m => (
                            <div key={m.label} className="bg-surface border border-border rounded-xl p-5">
                                <div className="text-xs text-foreground/40 uppercase tracking-widest mb-1">{m.label}</div>
                                <div className={`text-2xl font-bold ${m.color}`}>{fmtCurrency(m.value)}</div>
                            </div>
                        ))}
                    </div>
                    <div className="bg-surface border border-border rounded-xl p-6">
                        <h3 className="text-sm font-semibold text-foreground mb-4">{T.charts?.grossVsNet}</h3>
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={monthlyChart} margin={{ top: 0, right: 0, bottom: 0, left: -10 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-foreground)", opacity: 0.5 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 11, fill: "var(--color-foreground)", opacity: 0.5 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                                <Tooltip formatter={(v) => fmtCurrency(Number(Array.isArray(v) ? v[0] : (v ?? 0)))} contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                                <Legend />
                                <Bar dataKey="commission" name={T.commission?.gross} fill="var(--color-primary)" radius={[4,4,0,0]} />
                                <Bar dataKey="commission" name={T.commission?.net}   fill="#10B981" radius={[4,4,0,0]} opacity={0.7} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* Pipeline tab */}
            {activeTab === "pipeline" && (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        {pipelineData.map((stage, i) => (
                            <div key={stage.stage} className="bg-surface border border-border rounded-xl p-4 text-center">
                                <div className="text-2xl font-bold text-foreground">{stage.count}</div>
                                <div className="text-xs text-foreground/50 mt-1">{stage.stage}</div>
                                <div className="w-full h-1 rounded-full mt-3" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                            </div>
                        ))}
                    </div>
                    <div className="bg-surface border border-border rounded-xl p-6">
                        <h3 className="text-sm font-semibold text-foreground mb-4">{T.charts?.stageDistribution}</h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={pipelineData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                                <XAxis dataKey="stage" tick={{ fontSize: 10, fill: "var(--color-foreground)", opacity: 0.5 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 11, fill: "var(--color-foreground)", opacity: 0.5 }} axisLine={false} tickLine={false} />
                                <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                                {pipelineData.map((_, i) => (
                                    <Bar key={i} dataKey="count" fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
                                ))}
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* Leaderboard tab */}
            {activeTab === "leaderboard" && (
                <div className="bg-surface border border-border rounded-xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-foreground">{T.leaderboard?.title}</h3>
                        <button onClick={exportCSV} className="text-xs text-primary hover:underline">
                            {T.leaderboard?.export}
                        </button>
                    </div>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border bg-background/50">
                                <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-widest text-foreground/40 w-10">#</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-widest text-foreground/40">
                                    {T.leaderboard?.agent}
                                </th>
                                <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-widest text-foreground/40">
                                    {T.leaderboard?.ytdGross}
                                </th>
                                <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-widest text-foreground/40 hidden sm:table-cell">
                                    {T.leaderboard?.share}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {leaderboard
                                .sort((a, b) => b.ytd - a.ytd)
                                .map((row, i) => {
                                    const maxVal = leaderboard[0]?.ytd || 1;
                                    return (
                                        <tr key={row.agent} className="border-b border-border/50 last:border-0 hover:bg-surface-hover transition-colors">
                                            <td className="px-6 py-4">
                                                <span className={`text-sm font-bold ${i === 0 ? "text-amber-500" : i === 1 ? "text-foreground/40" : i === 2 ? "text-amber-700/60" : "text-foreground/20"}`}>
                                                    {i + 1}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-primary text-xs font-bold flex-shrink-0">
                                                        {row.agent.split(" ").map(w => w[0]).join("").substring(0,2)}
                                                    </div>
                                                    <span className="font-medium text-foreground">{row.agent}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right font-semibold text-foreground">
                                                {fmtCurrency(row.ytd)}
                                            </td>
                                            <td className="px-6 py-4 hidden sm:table-cell">
                                                <div className="flex items-center justify-end gap-2">
                                                    <div className="flex-1 max-w-24 bg-border rounded-full h-1.5">
                                                        <div className="h-full rounded-full bg-primary" style={{ width: `${(row.ytd / maxVal) * 100}%` }} />
                                                    </div>
                                                    <span className="text-xs text-foreground/40 w-8 text-right">
                                                        {Math.round((row.ytd / maxVal) * 100)}%
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
