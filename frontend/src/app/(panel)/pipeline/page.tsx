"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/I18nContext";
import { fmtLocale } from "@/lib/format";
import { useSettings } from "@/lib/settings/useSettings";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const token = () => (typeof window !== "undefined" ? localStorage.getItem("token") || "" : "");

type TransStatus = "OFFER_REVIEW" | "IN_CONTRACT" | "BOARD_PACKAGE" | "CLEARED_TO_CLOSE" | "CLOSED" | "FALLEN_THROUGH";

interface Transaction {
    id: string;
    price: number;
    status: TransStatus;
    createdAt: string;
    closingDate?: string;
    property: { id: string; address: string; city: string; propertyType?: string };
    client:   { id: string; firstName: string; lastName: string };
    agent:    { id: string; name: string };
}

const COLUMN_KEYS: { key: TransStatus; color: string; accent: string }[] = [
    { key: "OFFER_REVIEW",     color: "border-amber-500/40",  accent: "bg-amber-500/10 text-amber-500" },
    { key: "IN_CONTRACT",      color: "border-blue-500/40",   accent: "bg-blue-500/10 text-blue-500" },
    { key: "BOARD_PACKAGE",    color: "border-purple-500/40", accent: "bg-purple-500/10 text-purple-500" },
    { key: "CLEARED_TO_CLOSE", color: "border-green-500/40",  accent: "bg-green-500/10 text-green-500" },
    { key: "CLOSED",           color: "border-primary/40",    accent: "bg-primary/10 text-primary" },
];

const fmtPrice = (n: number) =>
    n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${(n / 1000).toFixed(0)}K`;

const daysSince = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    return Math.floor(ms / 86_400_000);
};

export default function PipelinePage() {
    const toast = useToast();
    const { t } = useI18n();
    const T = (t as any).pipeline ?? {};
    // New York "board package" stage: hidden in Uruguay unless turned on or a deal is already there
    const { policies } = useSettings();

    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [dragging, setDragging] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState<TransStatus | null>(null);
    const dragCard = useRef<Transaction | null>(null);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API}/api/transactions?limit=100`, {
                headers: { Authorization: `Bearer ${token()}` },
            });
            if (res.ok) {
                const d = await res.json();
                setTransactions(d.data || []);
            }
        } catch { toast.error(T.loadError); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    const handleDragStart = (e: React.DragEvent, tx: Transaction) => {
        dragCard.current = tx;
        setDragging(tx.id);
        e.dataTransfer.effectAllowed = "move";
    };

    const handleDragEnd = () => {
        setDragging(null);
        setDragOver(null);
        dragCard.current = null;
    };

    const handleDrop = async (targetStatus: TransStatus) => {
        const tx = dragCard.current;
        if (!tx || tx.status === targetStatus) return;

        setTransactions(prev =>
            prev.map(t => t.id === tx.id ? { ...t, status: targetStatus } : t)
        );

        try {
            const res = await fetch(`${API}/api/transactions/${tx.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
                body: JSON.stringify({ status: targetStatus }),
            });
            if (!res.ok) {
                setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, status: tx.status } : t));
                toast.error(T.updateFail);
            } else {
                const colLabel = T.columns?.[targetStatus];
                toast.success(`${T.movedTo} ${colLabel}`);
            }
        } catch {
            setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, status: tx.status } : t));
            toast.error(T.networkError);
        }
        setDragging(null);
        setDragOver(null);
    };

    const activeTxs = transactions.filter(t => t.status !== "FALLEN_THROUGH");
    const totalValue = activeTxs.reduce((s, t) => s + t.price, 0);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 text-foreground/40 gap-3">
                <div className="w-5 h-5 border-2 border-border border-t-primary rounded-full animate-spin" />
                {T.loading}
            </div>
        );
    }

    const activeDealLabel = activeTxs.length !== 1 ? T.activeDeals : T.activeDeal;

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Header */}
            <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">{T.title}</h1>
                    <p className="text-sm text-foreground/50 mt-0.5">
                        {activeTxs.length} {activeDealLabel} · {fmtPrice(totalValue)} {T.subtitle}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <a href="/transactions"
                        className="px-3 py-2 bg-surface border border-border rounded-lg text-sm text-foreground/60 hover:bg-surface-hover transition-colors">
                        {T.listView}
                    </a>
                    <a href="/transactions"
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-background rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        {T.newDeal}
                    </a>
                </div>
            </div>

            {/* Kanban board */}
            <div className="flex gap-4 overflow-x-auto pb-4 flex-1 min-h-0" style={{ scrollSnapType: "x mandatory" }}>
                {COLUMN_KEYS.filter(col => col.key !== "BOARD_PACKAGE" || policies.properties.usStyleDeal || transactions.some(tx => tx.status === col.key)).map(col => {
                    const colLabel = T.columns?.[col.key];
                    const colTxs = transactions.filter(t => t.status === col.key);
                    const colValue = colTxs.reduce((s, t) => s + t.price, 0);
                    const isOver = dragOver === col.key;

                    return (
                        <div
                            key={col.key}
                            style={{ scrollSnapAlign: "start", minWidth: "280px", maxWidth: "320px" }}
                            className={`flex flex-col flex-shrink-0 rounded-2xl border-2 transition-colors ${
                                isOver ? "border-primary/60 bg-primary/5" : `${col.color} bg-surface`
                            }`}
                            onDragOver={e => { e.preventDefault(); setDragOver(col.key); }}
                            onDragLeave={() => setDragOver(null)}
                            onDrop={() => handleDrop(col.key)}
                        >
                            <div className="px-4 pt-4 pb-3 border-b border-border flex items-center justify-between">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold text-foreground">{colLabel}</span>
                                        <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${col.accent}`}>
                                            {colTxs.length}
                                        </span>
                                    </div>
                                    {colTxs.length > 0 && (
                                        <div className="text-xs text-foreground/40 mt-0.5">{fmtPrice(colValue)}</div>
                                    )}
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[200px]">
                                {colTxs.length === 0 && (
                                    <div className={`rounded-xl border-2 border-dashed p-6 text-center text-xs text-foreground/30 transition-colors ${
                                        isOver ? "border-primary/40 text-primary/50" : "border-border/50"
                                    }`}>
                                        {T.dropHere}
                                    </div>
                                )}
                                {colTxs.map(tx => (
                                    <div
                                        key={tx.id}
                                        draggable
                                        onDragStart={e => handleDragStart(e, tx)}
                                        onDragEnd={handleDragEnd}
                                        className={`bg-background border border-border rounded-xl p-4 cursor-grab active:cursor-grabbing transition-all hover:shadow-md hover:border-primary/30 select-none ${
                                            dragging === tx.id ? "opacity-40 scale-95" : ""
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                            <div className="min-w-0">
                                                <div className="text-sm font-semibold text-foreground truncate leading-tight">
                                                    {tx.property?.address}
                                                </div>
                                                <div className="text-xs text-foreground/40 truncate">
                                                    {tx.property?.city}
                                                    {tx.property?.propertyType && ` · ${tx.property.propertyType}`}
                                                </div>
                                            </div>
                                            <div className="text-sm font-bold text-primary flex-shrink-0">
                                                {fmtPrice(tx.price)}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 mt-3">
                                            <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0">
                                                {tx.client?.firstName?.[0]}{tx.client?.lastName?.[0]}
                                            </div>
                                            <div className="text-xs text-foreground/60 truncate">
                                                {tx.client?.firstName} {tx.client?.lastName}
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border/50">
                                            <span className="text-[10px] text-foreground/30">
                                                {daysSince(tx.createdAt)}{T.daysInStage}
                                            </span>
                                            {tx.closingDate && (
                                                <span className="text-[10px] text-foreground/40 flex items-center gap-1">
                                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                                    {new Date(tx.closingDate).toLocaleDateString(fmtLocale(), { month: "short", day: "numeric" })}
                                                </span>
                                            )}
                                            <span className="text-[10px] text-foreground/30">{tx.agent?.name?.split(" ")[0]}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}

                {/* Fallen Through */}
                <div
                    style={{ scrollSnapAlign: "start", minWidth: "220px" }}
                    className="flex flex-col flex-shrink-0 rounded-2xl border-2 border-red-500/20 bg-surface"
                    onDragOver={e => { e.preventDefault(); setDragOver("FALLEN_THROUGH"); }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={() => handleDrop("FALLEN_THROUGH")}
                >
                    <div className="px-4 pt-4 pb-3 border-b border-border flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground/60">
                                {T.columns?.FALLEN_THROUGH}
                            </span>
                            <span className="px-1.5 py-0.5 rounded-full text-xs font-bold bg-red-500/10 text-red-400">
                                {transactions.filter(t => t.status === "FALLEN_THROUGH").length}
                            </span>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[120px]">
                        {transactions.filter(t => t.status === "FALLEN_THROUGH").length === 0 && (
                            <div className="rounded-xl border-2 border-dashed border-border/30 p-4 text-center text-xs text-foreground/20">
                                {T.noFallen}
                            </div>
                        )}
                        {transactions.filter(t => t.status === "FALLEN_THROUGH").map(tx => (
                            <div key={tx.id} className="bg-background/50 border border-border/50 rounded-lg p-3 opacity-60">
                                <div className="text-xs text-foreground/50 truncate">{tx.property?.address}</div>
                                <div className="text-xs text-foreground/30 mt-1">{fmtPrice(tx.price)}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Mobile hint */}
            <div className="mt-2 text-xs text-foreground/30 text-center md:hidden">
                {T.mobileHint}
            </div>
        </div>
    );
}
