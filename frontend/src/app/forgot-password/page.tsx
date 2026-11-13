"use client";
import React, { useState } from 'react';
import Link from 'next/link';
import { useI18n, SUPPORTED_LANGUAGES } from '@/lib/i18n/I18nContext';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const { t, language, setLanguage } = useI18n();
  const FP = (t as any).forgotPassword ?? {};
  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    try {
      const res = await fetch(`${API}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setStatus('sent');
      } else {
        const data = await res.json();
        setErrorMsg(data.error || FP.somethingWrong || 'Something went wrong');
        setStatus('error');
      }
    } catch {
      setErrorMsg(FP.networkError || 'Network error. Please try again.');
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen flex text-foreground bg-background">
      {/* Left Side */}
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
              {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code} className="bg-surface">{l.label}</option>)}
            </select>
          </div>
        </div>

        {/* Main form area */}
        <div className="flex-1 flex flex-col justify-center px-8 lg:px-24 py-4">
          <div className="max-w-md w-full mx-auto">

            {/* Back link */}
            <Link
              href="/login"
              className="text-xs text-foreground/40 hover:text-primary uppercase tracking-widest mb-8 inline-flex items-center gap-2 transition-colors"
            >
              {FP.backToLogin ?? '← Back to Login'}
            </Link>

            {status === 'sent' ? (
              <div className="mt-6 p-6 bg-green-500/10 border border-green-500/20 rounded-lg">
                <div className="text-green-400 font-semibold mb-2 text-lg">{FP.successTitle ?? 'Check your inbox'}</div>
                <p className="text-foreground/60 text-sm leading-relaxed">
                  {FP.successMsg ?? 'If that email is registered, a reset link has been sent. Check your spam folder if you don\'t see it.'}
                </p>
                <Link href="/login" className="mt-4 inline-block text-xs text-primary hover:underline uppercase tracking-widest transition-colors">
                  {FP.backToLogin ?? '← Back to Login'}
                </Link>
              </div>
            ) : (
              <>
                <div className="mt-4 mb-7">
                  <h1 className="text-3xl font-bold text-foreground mb-3">
                    {FP.title ?? 'Forgot Password?'}
                  </h1>
                  <p className="text-sm text-foreground/50 border-l-2 border-primary/50 pl-4">
                    {FP.subtitle ?? "Enter your email and we'll send a reset link."}
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {status === 'error' && (
                    <div className="px-4 py-2.5 bg-red-500/10 border border-red-500/20 text-red-500 text-sm tracking-widest uppercase">
                      {errorMsg}
                    </div>
                  )}

                  <div className="space-y-1.5 group">
                    <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 transition-colors group-focus-within:text-primary">
                      {FP.email ?? 'Email Address'}
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full px-0 py-2.5 bg-transparent border-b border-border focus:border-primary outline-none transition-colors font-sans text-base text-foreground placeholder:text-foreground/20"
                      placeholder="agent@xyz.com"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={status === 'loading'}
                    className="w-full py-2.5 bg-primary text-background rounded-lg text-sm uppercase tracking-widest font-semibold hover:bg-primary-hover disabled:opacity-50 flex items-center justify-center gap-3 group mt-2 transition-all"
                  >
                    {status === 'loading' ? (
                      <div className="w-4 h-4 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                    ) : (
                      <>
                        {FP.sendLink ?? 'Send Reset Link'}
                        <span className="transform group-hover:translate-x-1 transition-transform font-serif">&rarr;</span>
                      </>
                    )}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right Side - Branding/Hero (Hidden on Mobile) */}
      <div className="hidden md:flex w-1/2 bg-surface items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?ixlib=rb-4.0.3&auto=format&fit=crop&w=2000&q=80')] bg-cover bg-center opacity-20 filter grayscale" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
        <div className="relative z-10 max-w-lg p-12 animate-in fade-in slide-in-from-right-8 duration-1000 delay-300">
          <h2 className="text-4xl text-foreground font-bold leading-tight mb-8">
            {(t as any).login?.heroTitleP1 ?? 'The Standard in'} <br />
            <span className="text-primary italic">{(t as any).login?.heroTitleP2 ?? 'Real Estate'}</span>
          </h2>
          <div className="w-24 h-[1px] bg-primary mb-8" />
          <p className="font-sans text-lg text-foreground/60 leading-relaxed font-light">
            {(t as any).login?.heroSubtitle ?? ''}
          </p>
        </div>
      </div>
    </div>
  );
}
