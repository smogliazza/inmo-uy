"use client";

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import { useAuth } from '@/lib/auth/AuthContext';
import { useModules, routeAvailable } from '@/lib/modules';
import ModuleNotAvailable from '@/components/modules/ModuleNotAvailable';

const PUBLIC_ROUTES = [
    '/login', '/signup', '/forgot-password', '/reset-password',
    '/verify-email', '/public-listings', '/not-found',
];

export default function AuthLayoutWrapper({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { isLoading } = useAuth();
    const { isOn, loaded: modulesLoaded } = useModules();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    // A panel page whose module is off shows a 404 (only once the module list has loaded).
    const moduleOff = modulesLoaded && !routeAvailable(pathname, isOn);

    // "/" is the public marketing landing page
    const isAuthRoute = pathname === '/' || PUBLIC_ROUTES.some(r =>
        pathname === r || pathname.startsWith(r + '/')
    );

    // Close sidebar on route change (mobile nav)
    useEffect(() => {
        setSidebarOpen(false);
    }, [pathname]);

    // Lock body scroll when mobile sidebar is open
    useEffect(() => {
        if (sidebarOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [sidebarOpen]);

    if (isAuthRoute) {
        return (
            <div className="flex-1 w-full bg-background relative z-0">
                {children}
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center bg-background text-foreground/50 tracking-widest uppercase text-sm">
                Loading...
            </div>
        );
    }

    return (
        <div className="flex h-screen w-full overflow-hidden bg-background">
            {/* ── Desktop sidebar (always visible ≥ md) ── */}
            <div className="hidden md:flex">
                <Sidebar onClose={() => setSidebarOpen(false)} />
            </div>

            {/* ── Mobile sidebar overlay ── */}
            {sidebarOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-40 bg-black/50 md:hidden"
                        onClick={() => setSidebarOpen(false)}
                        aria-hidden="true"
                    />
                    {/* Drawer */}
                    <div className="fixed inset-y-0 left-0 z-50 md:hidden animate-in slide-in-from-left duration-300">
                        <Sidebar onClose={() => setSidebarOpen(false)} />
                    </div>
                </>
            )}

            {/* ── Main content area ── */}
            <div className="flex-1 flex flex-col min-w-0 bg-background relative z-0 overflow-hidden">
                <Header onMenuToggle={() => setSidebarOpen(v => !v)} />
                <main className="flex-1 overflow-y-auto p-4 lg:p-8 custom-scrollbar">
                    {moduleOff ? <ModuleNotAvailable /> : children}
                </main>
            </div>
        </div>
    );
}
