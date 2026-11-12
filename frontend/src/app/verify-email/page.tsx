"use client";
import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useI18n, SUPPORTED_LANGUAGES } from '@/lib/i18n/I18nContext';
import { useExtra } from '@/lib/i18n/extra';

function VerifyEmailContent() {
  const { t, language, setLanguage } = useI18n();
  const X = useExtra();
  const V = X.verifyEmail;
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  useEffect(() => {
    if (!token) { setStatus('error'); setMessage(V.noToken); return; }
    fetch(`${API}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.message?.includes('verified')) {
          setStatus('success');
          setTimeout(() => router.push('/login'), 3000);
        } else {
          setStatus('error');
          setMessage(data.error || V.failedTitle);
        }
      })
      .catch(() => { setStatus('error'); setMessage(t.login.serverError); });
  }, [token, router, API, V.noToken, V.failedTitle, t.login.serverError]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-8 relative"><div className="absolute top-6 right-8"><select value={language} onChange={e => setLanguage(e.target.value as any)} className="bg-surface border border-border text-foreground text-xs rounded-lg px-2.5 py-1 outline-none focus:border-primary cursor-pointer">{SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}</select></div>
      <div className="w-full max-w-md text-center">
        {status === 'loading' && (
          <>
            <div className="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-6" />
            <p className="text-foreground/50">{V.verifying}</p>
          </>
        )}
        {status === 'success' && (
          <div className="p-6 bg-green-500/10 border border-green-500/20 rounded-lg">
            <div className="text-4xl mb-4">✓</div>
            <div className="text-green-400 font-semibold text-xl mb-2">{V.verifiedTitle}</div>
            <p className="text-foreground/60 text-sm">{V.redirecting}</p>
          </div>
        )}
        {status === 'error' && (
          <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-lg">
            <div className="text-4xl mb-4 text-red-400">✕</div>
            <div className="text-red-400 font-semibold text-xl mb-2">{V.failedTitle}</div>
            <p className="text-foreground/60 text-sm mb-4">{message}</p>
            <Link href="/login" className="text-primary hover:underline text-sm uppercase tracking-widest">{V.backToLogin}</Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-background"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>}>
      <VerifyEmailContent />
    </Suspense>
  );
}
