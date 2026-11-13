"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useI18n, SUPPORTED_LANGUAGES } from "@/lib/i18n/I18nContext";
import { useAuth } from "@/lib/auth/AuthContext";
import { useTheme, ThemeName } from "@/lib/theme/ThemeContext";
import { fmtLocale } from "@/lib/format";

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface SearchResult {
    clients: { id: string; firstName: string; lastName: string; email?: string; funnelStage: string }[];
    properties: { id: string; address: string; city: string; state: string; price: number; status: string }[];
    transactions: { id: string; status: string; price: number; property: { address: string }; client: { firstName: string; lastName: string } }[];
}

interface Notification {
    id: string;
    type: string;
    title: string;
    message: string;
    readAt: string | null;
    link: string | null;
    createdAt: string;
}

interface HeaderProps {
    onMenuToggle?: () => void;
}

export default function Header({ onMenuToggle }: HeaderProps) {
    const { t, language, setLanguage } = useI18n();
    const { user, logout } = useAuth();
    const { theme, setTheme } = useTheme();
    const router = useRouter();

    // ── Search state ───────────────────────────────────────────────────────────
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Notification state ─────────────────────────────────────────────────────
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [notifOpen, setNotifOpen] = useState(false);
    const notifRef = useRef<HTMLDivElement>(null);

    // ── Dropdown state ─────────────────────────────────────────────────────────
    const [isLangOpen, setIsLangOpen] = useState(false);
    const [isThemeOpen, setIsThemeOpen] = useState(false);
    const langRef  = useRef<HTMLDivElement>(null);
    const themeRef = useRef<HTMLDivElement>(null);

    const getLocalizedName = (name: string | undefined) => {
        if (name === 'System Admin')    return (t as any).roles?.ADMIN    || name;
        if (name === 'Regional Manager') return (t as any).roles?.MANAGER || name;
        if (name === 'Sarah Agent')      return (t as any).roles?.AGENT   || name;
        return name || (t as any).sidebar?.guest || 'Guest';
    };

    // ── Close dropdowns on outside click ──────────────────────────────────────
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (langRef.current  && !langRef.current.contains(e.target as Node))  setIsLangOpen(false);
            if (themeRef.current && !themeRef.current.contains(e.target as Node)) setIsThemeOpen(false);
            if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // ── Fetch notifications ────────────────────────────────────────────────────
    const fetchNotifications = useCallback(async () => {
        const token = localStorage.getItem('token');
        if (!token) return;
        try {
            const res = await fetch(`${API}/api/notifications?limit=15`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const d = await res.json();
                setNotifications(d.notifications || []);
                setUnreadCount(d.unreadCount || 0);
            }
        } catch {}
    }, []);

    useEffect(() => {
        fetchNotifications();
        // Poll every 60 seconds
        const interval = setInterval(fetchNotifications, 60_000);
        return () => clearInterval(interval);
    }, [fetchNotifications]);

    // ── Debounced search ───────────────────────────────────────────────────────
    useEffect(() => {
        if (searchTimer.current) clearTimeout(searchTimer.current);
        if (searchQuery.trim().length < 2) {
            setSearchResults(null);
            return;
        }
        setSearchLoading(true);
        searchTimer.current = setTimeout(async () => {
            try {
                const token = localStorage.getItem('token');
                const res = await fetch(`${API}/api/search?q=${encodeURIComponent(searchQuery)}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                    const d = await res.json();
                    setSearchResults(d);
                    setSearchOpen(true);
                }
            } catch {}
            finally { setSearchLoading(false); }
        }, 350);
    }, [searchQuery]);

    const markAllRead = async () => {
        const token = localStorage.getItem('token');
        try {
            await fetch(`${API}/api/notifications/read-all`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}` },
            });
            setUnreadCount(0);
            setNotifications(prev => prev.map(n => ({ ...n, readAt: new Date().toISOString() })));
        } catch {}
    };

    const fmtTime = (iso: string) => {
        const d = new Date(iso);
        const now = new Date();
        const diff = (now.getTime() - d.getTime()) / 1000;
        if (diff < 60)    return 'just now';
        if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return d.toLocaleDateString(fmtLocale());
    };

    const themeNames = (t as any).settings?.appearance?.themeNames ?? {};
    const themes: { id: ThemeName; label: string; color: string }[] = [
        { id: "luxury",    label: themeNames.luxury    ?? "Luxury",    color: "#B8977E" },
        { id: "modern",    label: themeNames.modern    ?? "Modern",    color: "#4F7DF3" },
        { id: "youth",     label: themeNames.youth     ?? "Youth",     color: "#7C5CFC" },
        { id: "chinese",   label: themeNames.chinese   ?? "Chinese",   color: "#C43B38" },
        { id: "cyberpunk", label: themeNames.cyberpunk ?? "Cyberpunk", color: "#00F0FF" },
    ];

    const totalResults = searchResults
        ? (searchResults.clients.length + searchResults.properties.length + searchResults.transactions.length)
        : 0;

    return (
        <header className="h-14 bg-surface border-b border-border flex items-center justify-between px-4 md:px-6 flex-shrink-0 z-30">
            {/* Left: hamburger (mobile) + search */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* Hamburger — mobile only */}
                <button
                    onClick={onMenuToggle}
                    className="md:hidden p-2 text-foreground/50 hover:text-foreground hover:bg-surface-hover rounded-lg transition-colors flex-shrink-0"
                    aria-label="Open menu"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                </button>

                {/* Global Search */}
                <div className="relative flex-1 max-w-xs md:max-w-sm" ref={searchRef}>
                    <div className="relative">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            onFocus={() => totalResults > 0 && setSearchOpen(true)}
                            placeholder={(t as any).header?.searchPlaceholder || 'Search...'}
                            className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-lg text-sm focus:bg-surface focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-all text-foreground placeholder:text-foreground/30"
                        />
                        <span className="absolute left-3 top-2.5">
                            {searchLoading
                                ? <div className="w-4 h-4 border-2 border-border border-t-primary rounded-full animate-spin" />
                                : <svg className="w-4 h-4 text-foreground/30" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                            }
                        </span>
                    </div>

                    {/* Search results dropdown */}
                    {searchOpen && searchResults && totalResults > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-surface border border-border rounded-xl shadow-xl z-50 overflow-hidden max-h-96 overflow-y-auto">
                            {searchResults.clients.length > 0 && (
                                <div>
                                    <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-foreground/40 bg-background/50">
                                        {(t as any).header?.searchClients || 'Clients'}
                                    </div>
                                    {searchResults.clients.map(c => (
                                        <Link key={c.id} href={`/crm/${c.id}`} onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
                                            className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-hover transition-colors">
                                            <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-primary text-xs font-bold flex-shrink-0">
                                                {c.firstName[0]}{c.lastName[0]}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium text-foreground truncate">{c.firstName} {c.lastName}</div>
                                                <div className="text-xs text-foreground/40 truncate">{c.email} · {c.funnelStage}</div>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            )}
                            {searchResults.properties.length > 0 && (
                                <div>
                                    <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-foreground/40 bg-background/50">
                                        {(t as any).header?.searchProperties || 'Properties'}
                                    </div>
                                    {searchResults.properties.map(p => (
                                        <Link key={p.id} href={`/listings`} onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
                                            className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-hover transition-colors">
                                            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium text-foreground truncate">{p.address}</div>
                                                <div className="text-xs text-foreground/40">{p.city}, {p.state} · ${p.price.toLocaleString(fmtLocale())}</div>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            )}
                            {searchResults.transactions.length > 0 && (
                                <div>
                                    <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-foreground/40 bg-background/50">
                                        {(t as any).header?.searchTransactions || 'Transactions'}
                                    </div>
                                    {searchResults.transactions.map(tx => (
                                        <Link key={tx.id} href={`/transactions`} onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
                                            className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-hover transition-colors">
                                            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0 text-xs font-bold">
                                                TX
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium text-foreground truncate">{tx.property?.address}</div>
                                                <div className="text-xs text-foreground/40">{tx.client?.firstName} {tx.client?.lastName} · {tx.status}</div>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    {searchOpen && searchResults && totalResults === 0 && searchQuery.trim().length >= 2 && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-surface border border-border rounded-xl shadow-xl z-50 px-4 py-6 text-center text-sm text-foreground/40">
                            {(t as any).header?.noResults || 'No results for'} &ldquo;{searchQuery}&rdquo;
                        </div>
                    )}
                </div>
            </div>

            {/* Right: controls */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
                {/* Theme switcher */}
                <div className="relative block" ref={themeRef}>
                    <button onClick={() => setIsThemeOpen(v => !v)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-hover text-sm font-medium text-foreground transition-colors focus:outline-none">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: themes.find(t => t.id === theme)?.color }} />
                        <svg className={`w-3 h-3 text-foreground/40 transition-transform ${isThemeOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {isThemeOpen && (
                        <div className="absolute top-full right-0 mt-2 w-44 bg-surface rounded-xl shadow-lg border border-border overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                            {themes.map(th => (
                                <button key={th.id} onClick={() => { setTheme(th.id); setIsThemeOpen(false); }}
                                    className={`w-full text-left px-3 py-2.5 text-sm transition-colors flex items-center gap-2.5 ${theme === th.id ? 'bg-primary/10 text-primary font-semibold' : 'text-foreground/70 hover:bg-surface-hover'}`}>
                                    <span className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-border" style={{ backgroundColor: th.color }} />
                                    {th.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Language switcher */}
                <div className="relative block" ref={langRef}>
                    <button onClick={() => setIsLangOpen(v => !v)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-hover text-sm font-medium text-foreground transition-colors">
                        <svg className="w-3.5 h-3.5 text-foreground/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                        <span className="uppercase text-xs">
                            {language === 'zh-CN' ? '简' : language === 'zh-TW' ? '繁' : language === 'es' ? 'ES' : 'EN'}
                        </span>
                        <svg className={`w-3 h-3 text-foreground/40 transition-transform ${isLangOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {isLangOpen && (
                        <div className="absolute top-full right-0 mt-2 w-44 bg-surface rounded-xl shadow-lg border border-border overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                            {SUPPORTED_LANGUAGES.map(l => (
                                <button key={l.code} onClick={() => { setLanguage(l.code as any); setIsLangOpen(false); }}
                                    className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${language === l.code ? 'bg-primary/10 text-primary font-semibold' : 'text-foreground/70 hover:bg-surface-hover'}`}>
                                    {l.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Notification bell */}
                <div className="relative" ref={notifRef}>
                    <button
                        onClick={() => { setNotifOpen(v => !v); if (!notifOpen) fetchNotifications(); }}
                        className="relative p-2 text-foreground/50 hover:text-foreground hover:bg-surface-hover rounded-lg transition-colors"
                        aria-label="Notifications"
                    >
                        <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                        </svg>
                        {unreadCount > 0 && (
                            <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 bg-primary text-background text-[9px] font-bold rounded-full flex items-center justify-center">
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </span>
                        )}
                    </button>

                    {notifOpen && (
                        <div className="absolute top-full right-0 mt-2 w-80 bg-surface border border-border rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                                <span className="text-sm font-semibold text-foreground">
                                    {(t as any).header?.notifications || 'Notifications'}
                                </span>
                                {unreadCount > 0 && (
                                    <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                                        {(t as any).header?.markAllRead || 'Mark all read'}
                                    </button>
                                )}
                            </div>
                            <div className="max-h-80 overflow-y-auto">
                                {notifications.length === 0 ? (
                                    <div className="px-4 py-8 text-center text-sm text-foreground/40">
                                        {(t as any).header?.noNotifications}
                                    </div>
                                ) : notifications.map(n => (
                                    <div
                                        key={n.id}
                                        className={`px-4 py-3 border-b border-border/50 last:border-0 hover:bg-surface-hover transition-colors cursor-pointer ${!n.readAt ? 'bg-primary/5' : ''}`}
                                        onClick={() => {
                                            if (n.link) router.push(n.link);
                                            setNotifOpen(false);
                                        }}
                                    >
                                        <div className="flex items-start gap-2.5">
                                            {!n.readAt && <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />}
                                            {n.readAt  && <span className="w-1.5 h-1.5 mt-1.5 flex-shrink-0" />}
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm font-medium text-foreground leading-tight">{n.title}</div>
                                                <div className="text-xs text-foreground/50 mt-0.5 leading-relaxed">{n.message}</div>
                                                <div className="text-xs text-foreground/30 mt-1">{fmtTime(n.createdAt)}</div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* User info + logout */}
                <div className="flex items-center gap-2 pl-2 ml-1 border-l border-border">
                    <div className="hidden sm:flex flex-col text-right">
                        <span className="text-sm font-semibold text-foreground leading-tight">{getLocalizedName(user?.name)}</span>
                        <span className="text-xs text-primary font-medium">{user?.role ? ((t as any).roles?.[user.role] || user.role) : ''}</span>
                    </div>
                    <button
                        onClick={logout}
                        className="p-1.5 text-foreground/30 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                        title={(t as any).header?.logout || 'Logout'}
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                    </button>
                </div>
            </div>
        </header>
    );
}
