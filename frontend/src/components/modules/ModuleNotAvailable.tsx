"use client";

import Link from "next/link";
import { useExtra } from "@/lib/i18n/extra";

/** Shown instead of a panel page whose module is off (the API answers 404 module_disabled for it too). */
export default function ModuleNotAvailable() {
  const X = useExtra().modules;
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 px-6">
      <div className="text-7xl font-bold text-foreground/10 mb-4 select-none">404</div>
      <h1 className="text-xl font-bold text-foreground mb-2">{X.notAvailableTitle}</h1>
      <p className="text-foreground/50 text-sm mb-8 max-w-md">{X.notAvailableDesc}</p>
      <Link href="/dashboard" className="px-5 py-2.5 bg-primary text-background text-sm font-semibold rounded-lg hover:opacity-90 transition">
        {X.backToDashboard}
      </Link>
    </div>
  );
}
