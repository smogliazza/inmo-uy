"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { useI18n } from "@/lib/i18n/I18nContext";
import { useExtra } from "@/lib/i18n/extra";
import { useAuth } from "@/lib/auth/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { useRouter, useSearchParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function UpgradePageInner() {
  const { t } = useI18n();
  const X = useExtra();
  const UX = X.upgradeExtra;
  const { user, login } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();

  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("annual");
  const [selectedPlan, setSelectedPlan] = useState<"CORE" | "PRO" | "ELITE">((user?.tier as "CORE" | "PRO" | "ELITE") || "CORE");

  // Checkout Modal State
  const [showCheckout, setShowCheckout] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const handledReturn = useRef(false);

  // Handle return from Stripe Checkout (?success=true / ?canceled=true)
  useEffect(() => {
    if (handledReturn.current) return;
    if (searchParams.get("canceled") === "true") {
      handledReturn.current = true;
      toast.error(t.upgrade.checkout.sessionExpired || "Checkout was canceled.");
      router.replace("/upgrade");
      return;
    }
    if (searchParams.get("success") === "true") {
      handledReturn.current = true;
      // Payment completed — webhook has upgraded the DB tier, but our JWT still
      // carries the old tier. Refresh the token so gated features unlock now.
      const oldToken = localStorage.getItem("token");
      if (!oldToken) return;
      fetch(`${API}/api/auth/refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${oldToken}` },
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.token && data.user) {
            login(data.token, data.user);
            setSelectedPlan(data.user.tier);
          }
          setCheckoutSuccess(true);
          setShowCheckout(true);
          router.replace("/upgrade");
        })
        .catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Subscription is org-wide and only org admins may purchase (enforced server-side too)
  const canPurchase = ["SUPERADMIN", "FIRMADMIN"].includes(user?.role || "");

  const handleSelectPlan = (plan: "CORE" | "PRO" | "ELITE") => {
    if (plan === user?.tier) return;
    if (plan === "CORE") return; // cannot downgrade to core from here
    if (!canPurchase) {
      toast.info((t.upgrade as any).adminOnly || "Plans cover your whole firm — ask your Firm Admin to upgrade.");
      return;
    }
    setSelectedPlan(plan);
    setCheckoutSuccess(false);
    setShowCheckout(true);
  };

  const currentPlanObj = selectedPlan === "PRO" ? t.upgrade.pro : t.upgrade.elite;
  const currentPrice = billingCycle === "annual" ? (currentPlanObj as any).priceA : (currentPlanObj as any).priceM;
  const planIdToPurchase = `${selectedPlan}_${billingCycle.toUpperCase()}`;

  // Create a Stripe Checkout Session and redirect to Stripe's hosted payment page
  const processPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);

    try {
      const token = localStorage.getItem("token");
      if (!token) throw new Error("No token");

      const checkoutRes = await fetch(`${API}/api/payments/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ planId: planIdToPurchase }),
      });
      const checkoutData = await checkoutRes.json();

      if (!checkoutRes.ok) throw new Error(checkoutData.error);
      if (!checkoutData.url) throw new Error("Payment service did not return a checkout link.");

      // Hand off to Stripe's secure hosted checkout
      window.location.href = checkoutData.url;
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || t.upgrade.checkout.sessionExpired || "Checkout failed. Please try again.");
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      {/* Hero Section */}
      <div className="pt-24 pb-16 px-6 text-center animate-in fade-in slide-in-from-bottom-8 duration-700">
        <h1 className="text-3xl font-bold tracking-tight mb-4">
          {t.upgrade.title}
        </h1>
        {!canPurchase && (
          <div className="max-w-xl mx-auto mb-4 px-4 py-2.5 rounded-lg bg-primary/10 text-primary text-sm">
            {(t.upgrade as any).adminOnly || "Plans cover your whole firm — ask your Firm Admin to upgrade."}
          </div>
        )}
        <p className="text-sm text-foreground/50 max-w-2xl mx-auto leading-relaxed">
          {t.upgrade.subtitle}
        </p>

        {/* Toggle billing */}
        <div className="mt-12 inline-flex items-center gap-4 bg-surface p-1 rounded-full border border-border">
          <button
            onClick={() => setBillingCycle("monthly")}
            className={`px-6 py-2 rounded-full text-base font-sans uppercase tracking-widest transition-all ${
              billingCycle === "monthly" ? "bg-background shadow text-foreground" : "text-foreground/50 hover:text-foreground"
            }`}
          >
            {t.upgrade.monthly}
          </button>
          <button
            onClick={() => setBillingCycle("annual")}
            className={`px-6 py-2 rounded-full text-base font-sans uppercase tracking-widest transition-all flex items-center gap-2 ${
              billingCycle === "annual" ? "bg-background shadow text-foreground" : "text-foreground/50 hover:text-foreground"
            }`}
          >
            {t.upgrade.annual}
            <span className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full font-medium">
              {t.upgrade.save}
            </span>
          </button>
        </div>
      </div>

      {/* Pricing Cards */}
      <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-6 pb-12 animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-200">
        
        {/* Core Card */}
        <div className={`p-6 rounded-xl flex flex-col transition-all duration-300 ${user?.tier === "CORE" ? "bg-surface ring-2 ring-primary/20 shadow-lg" : "bg-background border border-border hover:shadow-md"}`}>
          <div className="mb-8">
            <h3 className="font-sans font-medium tracking-wide text-2xl mb-2">{t.upgrade.core.name}</h3>
            <div className="flex items-baseline gap-1 mt-4">
              <span className="text-5xl font-light font-sans tracking-tight">{t.upgrade.core.price}</span>
            </div>
            <p className="text-foreground/50 text-base mt-4 min-h-[40px] leading-relaxed">{t.upgrade.core.desc}</p>
          </div>
          <ul className="space-y-4 mb-8 flex-grow">
            {t.upgrade.core.features.map((feat: string, i: number) => (
              <li key={i} className="flex items-start gap-3 text-base text-foreground/70">
                <svg className="w-5 h-5 text-primary/70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
                </svg>
                {feat}
              </li>
            ))}
          </ul>
          <button disabled className="w-full py-3 rounded-xl border border-border/60 text-foreground/40 font-medium cursor-not-allowed">
            {user?.tier === "CORE" ? t.upgrade.core.btn : "-"}
          </button>
        </div>

        {/* Pro Card */}
        <div className={`p-8 rounded-2xl flex flex-col relative transition-all duration-300 transform shadow-2xl ${user?.tier === "PRO" ? "bg-gradient-to-b from-surface to-background ring-2 ring-primary" : "bg-gradient-to-b from-primary/5 to-background border border-primary/20 hover:ring-1 hover:ring-primary/40"}`}>
          <div className="absolute top-0 inset-x-0 h-1.5 bg-primary rounded-t-2xl"></div>
          <div className="mb-8 mt-2">
            <h3 className="font-sans font-bold tracking-wide text-2xl mb-2 text-primary">{t.upgrade.pro.name}</h3>
            <div className="flex items-baseline gap-1 mt-4">
              <span className="text-5xl font-light font-sans tracking-tight">{billingCycle === 'annual' ? t.upgrade.pro.priceA : t.upgrade.pro.priceM}</span>
              <span className="text-foreground/40 text-base font-medium">/{billingCycle === 'annual' ? "yr" : "mo"}</span>
            </div>
            <p className="text-foreground/60 text-base mt-4 min-h-[40px] leading-relaxed">{t.upgrade.pro.desc}</p>
          </div>
          <ul className="space-y-4 mb-8 flex-grow">
            {t.upgrade.pro.features.map((feat: string, i: number) => (
              <li key={i} className="flex items-start gap-3 text-base text-foreground/90 font-medium">
                <svg className="w-5 h-5 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {feat}
              </li>
            ))}
          </ul>
          {user?.tier === "PRO" ? (
             <button disabled className="w-full py-3 rounded-xl bg-surface border border-primary/50 text-primary font-semibold">
               {t.upgrade.core.btn}
             </button>
          ) : (
             <button onClick={() => handleSelectPlan("PRO")} className="w-full py-3 rounded-xl bg-primary text-background font-semibold hover:opacity-90 transition-opacity shadow-md hover:shadow-lg">
               {t.upgrade.pro.btn}
             </button>
          )}
        </div>

        {/* Elite Card */}
        <div className={`p-8 rounded-2xl flex flex-col transition-all duration-300 ${user?.tier === "ELITE" ? "bg-surface ring-2 ring-primary/40 shadow-xl" : "bg-background border border-border/50 hover:shadow-md hover:border-border"}`}>
          <div className="mb-8">
            <h3 className="font-sans font-medium tracking-wide text-2xl mb-2">{t.upgrade.elite.name}</h3>
            <div className="flex items-baseline gap-1 mt-4">
              <span className="text-5xl font-light font-sans tracking-tight">{billingCycle === 'annual' ? t.upgrade.elite.priceA : t.upgrade.elite.priceM}</span>
              <span className="text-foreground/40 text-base font-medium">/{billingCycle === 'annual' ? "yr" : "mo"}</span>
            </div>
            <p className="text-foreground/50 text-base mt-4 min-h-[40px] leading-relaxed">{t.upgrade.elite.desc}</p>
          </div>
          <ul className="space-y-4 mb-8 flex-grow">
            {t.upgrade.elite.features.map((feat: string, i: number) => (
              <li key={i} className="flex items-start gap-3 text-base text-foreground/70">
                <svg className="w-5 h-5 text-primary/70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
                </svg>
                {feat}
              </li>
            ))}
          </ul>
          {user?.tier === "ELITE" ? (
             <button disabled className="w-full py-3 rounded-xl bg-surface border border-primary/50 text-primary font-semibold">
               {t.upgrade.core.btn}
             </button>
          ) : (
             <button onClick={() => handleSelectPlan("ELITE")} className="w-full py-3 rounded-xl bg-foreground text-background font-semibold hover:bg-foreground/80 transition-opacity shadow-md">
               {t.upgrade.elite.btn}
             </button>
          )}
        </div>
      </div>

      {/* Checkout Modal Overlay — success pane doubles as the post-Stripe return screen */}
      {showCheckout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-md animate-in fade-in duration-300 p-4">
          <div className="bg-background rounded-3xl border border-border/40 w-full max-w-3xl shadow-2xl flex flex-col md:flex-row overflow-hidden ring-1 ring-black/5">
            
            {/* Left Summary Pane */}
            <div className="w-full md:w-2/5 bg-surface/50 p-8 md:p-10 border-r border-border/40 border-b md:border-b-0 flex flex-col justify-between">
               <div>
                 <h4 className="font-sans font-medium text-xl mb-6">{t.upgrade.checkout.title}</h4>
                 <p className="text-base text-foreground/60 mb-1">{t.upgrade.checkout.desc}</p>
                 <h5 className="font-sans font-bold text-3xl text-primary">{currentPlanObj.name}</h5>
                 <p className="text-sm font-medium uppercase tracking-widest text-foreground/40 mt-2 mb-8">{billingCycle}</p>
               </div>
               
               <div className="pt-8 border-t border-border/40">
                 <p className="text-base text-foreground/60 mb-2 font-medium">{t.upgrade.checkout.total}</p>
                 <p className="font-sans font-light tracking-tight text-4xl">{currentPrice}</p>
               </div>
            </div>

            {/* Right Payment Pane */}
            <div className="w-full md:w-3/5 p-8 md:p-10 relative bg-background">
               {!checkoutSuccess ? (
                 <form onSubmit={processPayment} className="h-full flex flex-col justify-center">
                   <div className="flex flex-col items-center text-center py-8 animate-in fade-in">
                     <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
                       <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                       </svg>
                     </div>
                     <h4 className="font-sans font-bold text-xl mb-3">{UX.secureCheckout}</h4>
                     <p className="text-foreground/60 text-base font-medium leading-relaxed max-w-xs mx-auto mb-2">
                       {UX.redirectNotice}
                     </p>
                     <p className="text-foreground/40 text-sm">
                       {UX.noCardStored}
                     </p>
                   </div>

                   <div className="pt-6 flex gap-3 mt-4">
                      <button type="button" disabled={isProcessing} onClick={() => setShowCheckout(false)} className="flex-1 py-3.5 rounded-xl border border-border/80 text-foreground/70 font-semibold hover:bg-surface transition-colors">
                        {t.upgrade.checkout.cancel}
                      </button>
                      <button type="submit" disabled={isProcessing} className="flex-[2] py-3.5 rounded-xl bg-primary text-background font-semibold hover:opacity-90 transition-opacity shadow-md disabled:opacity-50 flex items-center justify-center">
                        {isProcessing ? (
                           <div className="w-5 h-5 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                        ) : t.upgrade.checkout.payWith}
                      </button>
                   </div>
                 </form>
               ) : (
                 <div className="h-full flex flex-col items-center justify-center text-center animate-in zoom-in-95 duration-500 py-12">
                   <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
                     <svg className="w-10 h-10 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                     </svg>
                   </div>
                   <h3 className="font-sans font-bold text-2xl mb-3">{t.upgrade.checkout.success} <span className="text-primary">{currentPlanObj.name}</span></h3>
                   <p className="text-foreground/60 mb-10 font-medium">{t.upgrade.checkout.successDesc}</p>
                   <button onClick={() => router.push('/dashboard')} className="w-full py-3.5 rounded-xl bg-primary text-background font-semibold hover:opacity-90 transition-opacity shadow-md">
                     {t.upgrade.checkout.returnDash}
                   </button>
                 </div>
               )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

// useSearchParams requires a Suspense boundary in the App Router
export default function UpgradePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-border border-t-primary rounded-full animate-spin" />
      </div>
    }>
      <UpgradePageInner />
    </Suspense>
  );
}
