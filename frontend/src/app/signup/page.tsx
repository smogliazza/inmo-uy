"use client";

import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { useI18n } from "@/lib/i18n/I18nContext";
import { useInstallationModules } from "@/lib/modules";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// ─── Inner component that uses useSearchParams ────────────────────────────────
function SignupForm() {
  const searchParams = useSearchParams();

  // Invite params from email link: ?invite=TOKEN&email=...&org=ORGID&role=AGENT
  const inviteToken  = searchParams.get("invite") ?? "";
  const inviteOrgId  = searchParams.get("org")    ?? "";
  const inviteEmail  = searchParams.get("email")  ?? "";
  const inviteRole   = searchParams.get("role")   ?? "AGENT";
  const isInviteMode = !!inviteToken;

  const [formData, setFormData] = useState({
    name:     "",
    email:    inviteEmail,
    password: "",
    orgName:  "",
  });
  const [error,     setError]     = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { login }                    = useAuth();
  const { t, language, setLanguage } = useI18n();
  const installModules = useInstallationModules(); // the Google sign-in button shows only when the googleOAuth module is on
  const S = t.signup as any;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      let res: Response;

      if (isInviteMode) {
        // Join an existing org via invite link
        res = await fetch(`${API}/api/auth/accept-invite`, {
          method:  "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" },
          body:    JSON.stringify({
            name:        formData.name,
            email:       formData.email || inviteEmail,
            password:    formData.password,
            inviteToken, // org membership & role are resolved server-side from this token
          }),
        });
      } else {
        // Create a new org + become FIRMADMIN
        res = await fetch(`${API}/api/auth/register`, {
          method:  "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" },
          body:    JSON.stringify(formData),
        });
      }

      const data = await res.json();

      if (res.ok && data.token) {
        login(data.token, data.user);
      } else {
        setError(data.error || S.registrationFailed);
      }
    } catch {
      setError(S.serverError);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex text-foreground bg-background">
      {/* Left Side - Form */}
      <div className="w-full md:w-1/2 flex flex-col border-r border-border animate-in fade-in slide-in-from-left-8 duration-700">

        {/* Top bar — language switcher */}
        <div className="flex items-center justify-end px-8 lg:px-24 pt-6 pb-2">
          <div className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-foreground/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
            </svg>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as any)}
              className="bg-transparent border-b border-border text-foreground/60 outline-none text-xs pb-0.5 cursor-pointer hover:border-primary hover:text-foreground transition-colors focus:border-primary"
            >
              <option value="en"    className="bg-surface">English</option>
              <option value="zh-CN" className="bg-surface">中文（简体）</option>
              <option value="zh-TW" className="bg-surface">中文（繁體）</option>
              <option value="es"    className="bg-surface">Español</option>
            </select>
          </div>
        </div>

        {/* Main form area */}
        <div className="flex-1 flex flex-col justify-center px-8 lg:px-24 py-4">
          <div className="max-w-md w-full mx-auto">

            {/* Invite banner */}
            {isInviteMode && (
              <div className="mb-6 px-4 py-3 bg-primary/10 border border-primary/20 rounded-lg text-sm text-primary flex items-start gap-3">
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span>{S.inviteBanner ?? "You have been invited to join a team. Complete your profile to get started."}</span>
              </div>
            )}

            <div className="mb-7">
              <h1 className="text-3xl font-bold text-foreground mb-3">
                {isInviteMode ? (S.inviteTitle ?? "Accept Invitation") : S.title}
              </h1>
              <p className="text-sm text-foreground/50 border-l-2 border-primary/50 pl-4">
                {isInviteMode
                  ? (S.inviteSubtitle ?? "Set up your account to join your team.")
                  : S.subtitle}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="px-4 py-2.5 bg-red-500/10 border border-red-500/20 text-red-500 font-sans text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-1.5 group">
                <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 transition-colors group-focus-within:text-primary">
                  {S.fullName}
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  value={formData.name}
                  onChange={handleChange}
                  className="w-full px-0 py-2.5 bg-transparent border-b border-border focus:border-primary outline-none transition-colors font-sans text-base text-foreground placeholder:text-foreground/20"
                  placeholder="John Doe"
                />
              </div>

              <div className="space-y-1.5 group">
                <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 transition-colors group-focus-within:text-primary">
                  {S.email}
                </label>
                <input
                  type="email"
                  name="email"
                  required
                  value={formData.email}
                  onChange={isInviteMode ? undefined : handleChange}
                  readOnly={isInviteMode}
                  className={`w-full px-0 py-2.5 bg-transparent border-b outline-none transition-colors font-sans text-base text-foreground placeholder:text-foreground/20 ${
                    isInviteMode
                      ? "border-border/40 text-foreground/50 cursor-default"
                      : "border-border focus:border-primary"
                  }`}
                  placeholder="agent@xyz.com"
                />
              </div>

              {/* Org field: show as locked badge in invite mode, editable otherwise */}
              {isInviteMode ? (
                <div className="space-y-1.5">
                  <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50">
                    {S.org}
                  </label>
                  <div className="flex items-center gap-2 py-2.5 border-b border-border/40">
                    <svg className="w-3.5 h-3.5 text-primary/70 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    <span className="font-sans text-base text-foreground/60 italic">
                      {S.inviteJoining ?? "Joining invited organization"}
                    </span>
                    <span className="ml-auto px-2 py-0.5 bg-primary/10 text-primary text-xs rounded font-medium">{inviteRole}</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5 group">
                  <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 transition-colors group-focus-within:text-primary">
                    {S.org}
                  </label>
                  <input
                    type="text"
                    name="orgName"
                    required
                    value={formData.orgName}
                    onChange={handleChange}
                    className="w-full px-0 py-2.5 bg-transparent border-b border-border focus:border-primary outline-none transition-colors font-sans text-base text-foreground placeholder:text-foreground/20"
                    placeholder={S.orgPlaceholder}
                  />
                </div>
              )}

              <div className="space-y-1.5 group pb-1">
                <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 transition-colors group-focus-within:text-primary">
                  {S.password}
                </label>
                <input
                  type="password"
                  name="password"
                  required
                  minLength={8}
                  value={formData.password}
                  onChange={handleChange}
                  className="w-full px-0 py-2.5 bg-transparent border-b border-border focus:border-primary outline-none transition-colors font-sans text-base text-foreground placeholder:text-foreground/20"
                  placeholder="••••••••"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 bg-primary text-background rounded-lg text-sm uppercase tracking-widest font-semibold transition-all hover:bg-primary-hover disabled:opacity-50 flex items-center justify-center gap-3 group mt-2"
              >
                {isLoading ? (
                  <div className="w-4 h-4 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                ) : (
                  <>
                    {isInviteMode ? (S.acceptInvite ?? "Accept & Join") : S.createAccount}
                    <span className="transform group-hover:translate-x-1 transition-transform font-serif">&rarr;</span>
                  </>
                )}
              </button>

              {!isInviteMode && (
                <>
                  <div className="relative flex py-3 items-center">
                    <div className="flex-grow border-t border-border"></div>
                    <span className="flex-shrink-0 mx-4 text-foreground/30 text-sm font-sans tracking-widest">OR</span>
                    <div className="flex-grow border-t border-border"></div>
                  </div>

                  {/* OAuth buttons — coming soon */}
                  <div className="space-y-3">
                    {installModules?.googleOAuth && (<button type="button" disabled title="OAuth integration — coming soon"
                      className="w-full py-2.5 bg-surface border border-border text-foreground/40 text-sm uppercase tracking-widest flex items-center justify-center gap-3 cursor-not-allowed opacity-60 rounded-lg">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                      {S.continueGoogle}
                      <span className="text-[10px] text-foreground/30 ml-1">(Coming Soon)</span>
                    </button>)}

                    <button type="button" disabled title="OAuth integration — coming soon"
                      className="w-full py-2.5 bg-surface border border-border text-foreground/40 text-sm uppercase tracking-widest flex items-center justify-center gap-3 cursor-not-allowed opacity-60 rounded-lg">
                      <svg className="w-4 h-4" viewBox="0 0 384 512" fill="currentColor">
                        <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/>
                      </svg>
                      {S.continueApple}
                      <span className="text-[10px] text-foreground/30 ml-1">(Coming Soon)</span>
                    </button>
                  </div>
                </>
              )}
            </form>

            <div className="mt-5 pt-5 border-t border-border font-sans text-sm text-foreground/50">
              <p>
                {S.hasAccount}{" "}
                <Link href="/login" className="text-primary hover:underline uppercase tracking-widest text-sm font-medium">
                  {S.signIn}
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Branding/Hero (Hidden on Mobile) */}
      <div className="hidden md:flex w-1/2 bg-surface items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1512917774080-9991f1c4c750?ixlib=rb-4.0.3&auto=format&fit=crop&w=2000&q=80')] bg-cover bg-center opacity-20 filter grayscale" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
        <div className="relative z-10 max-w-lg p-12 animate-in fade-in slide-in-from-right-8 duration-1000 delay-300">
          <h2 className="text-4xl text-foreground font-bold leading-tight mb-8">
            {S.heroTitleP1} <br />
            <span className="text-primary italic">{S.heroTitleP2}</span>
          </h2>
          <div className="w-24 h-[1px] bg-primary mb-8" />
          <p className="font-sans text-lg text-foreground/60 leading-relaxed font-light">
            {S.heroSubtitle}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Page wrapper with Suspense (required for useSearchParams in App Router) ──
export default function SignupPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-border border-t-primary rounded-full animate-spin" />
      </div>
    }>
      <SignupForm />
    </Suspense>
  );
}
