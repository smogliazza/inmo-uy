"use client";
import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useI18n, SUPPORTED_LANGUAGES } from '@/lib/i18n/I18nContext';

function ResetPasswordForm() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const { t, language, setLanguage } = useI18n();
  const RP = (t as any).resetPassword ?? {};
  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  useEffect(() => {
    if (!token) router.push('/forgot-password');
  }, [token, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setErrorMsg(RP.mismatch || 'Passwords do not match');
      setStatus('error');
      return;
    }
    if (password.length < 8) {
      setErrorMsg(RP.tooShort || 'Password must be at least 8 characters');
      setStatus('error');
      return;
    }
    setStatus('loading');
    try {
      const res = await fetch(`${API}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus('success');
        setTimeout(() => router.push('/login'), 2500);
      } else {
        setErrorMsg(data.error || RP.resetFailed || 'Reset failed');
        setStatus('error');
      }
    } catch {
      setErrorMsg(RP.networkError || 'Network error. Please try again.');
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
              {RP.backToLogin ?? '← Back to Login'}
            </Link>

            {status === 'success' ? (
              <div className="mt-6 p-6 bg-green-500/10 border border-green-500/20 rounded-lg">
                <div className="text-green-400 font-semibold mb-2 text-lg">{RP.successTitle ?? 'Password Updated!'}</div>
                <p className="text-foreground/60 text-sm">{RP.successMsg ?? 'Redirecting you to login...'}</p>
                <div className="mt-3 flex items-center gap-2 text-foreground/40 text-sm">
                  <div className="w-3 h-3 border-2 border-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
                  <span>{RP.successMsg ?? 'Redirecting...'}</span>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-4 mb-7">
                  <h1 className="text-3xl font-bold text-foreground mb-3">
                    {RP.title ?? 'Set New Password'}
                  </h1>
                  <p className="text-sm text-foreground/50 border-l-2 border-primary/50 pl-4">
                    {RP.subtitle ?? 'Choose a strong password of at least 8 characters.'}
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
                      {RP.newPassword ?? 'New Password'}
                    </label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full px-0 py-2.5 bg-transparent border-b border-border focus:border-primary outline-none transition-colors font-sans text-base text-foreground placeholder:text-foreground/20"
                      placeholder="••••••••"
                    />
                  </div>

                  <div className="space-y-1.5 group pb-1">
                    <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 transition-colors group-focus-within:text-primary">
                      {RP.confirmPassword ?? 'Confirm Password'}
                    </label>
                    <input
                      type="password"
                      required
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      className="w-full px-0 py-2.5 bg-transparent border-b border-border focus:border-primary outline-none transition-colors font-sans text-base text-foreground placeholder:text-foreground/20"
                      placeholder="••••••••"
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
                        {RP.update ?? 'Update Password'}
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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}
