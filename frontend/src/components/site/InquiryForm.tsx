"use client";
// Inquiry form of a listing (spec 8.4 / 13): creates the interested person in the brokerage's CRM. Consent
// checkbox (Ley 18.331) linked to the privacy policy, a honeypot field and the API's rate limit against bots.
import { useState } from "react";
import type { SiteStrings } from "@/lib/site/context";
import { fmt } from "@/lib/site/format";

export default function InquiryForm({ api, slug, propertyId, orgName, privacyHref, S }: {
  api: string; slug: string; propertyId: string; orgName: string; privacyHref: string; S: SiteStrings;
}) {
  const L = S.form;
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const name = data.name?.trim(), email = data.email?.trim(), phone = data.phone?.trim();
    if (!name) return setError(L.errName);
    if (!email && !phone) return setError(L.errContact);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError(L.errEmail);
    if (!data.consent) return setError(L.errConsent);
    setError(null);
    setState("sending");
    try {
      const res = await fetch(`${api}/api/public/listings/${encodeURIComponent(propertyId)}/inquiry?site=${encodeURIComponent(slug)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, message: data.message, consent: true, website: data.website }),
      });
      if (res.ok) return setState("sent");
      const body = await res.json().catch(() => null);
      const byCode: Record<string, string> = { NAME_REQUIRED: L.errName, CONTACT_REQUIRED: L.errContact, EMAIL_INVALID: L.errEmail, CONSENT_REQUIRED: L.errConsent };
      setError(res.status === 429 ? L.errRate : byCode[body?.code] || L.errGeneric);
    } catch {
      setError(L.errGeneric);
    }
    setState("idle");
  }

  if (state === "sent") return <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{L.sent}</p>;

  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <div>
        <label htmlFor="q-name" className="text-sm font-medium">{L.name} <span className="text-slate-500">({L.required})</span></label>
        <input id="q-name" name="name" autoComplete="name" required className={input} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="q-phone" className="text-sm font-medium">{L.phone}</label>
          <input id="q-phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" className={input} />
        </div>
        <div>
          <label htmlFor="q-email" className="text-sm font-medium">{L.email}</label>
          <input id="q-email" name="email" type="email" autoComplete="email" className={input} />
        </div>
      </div>
      <div>
        <label htmlFor="q-msg" className="text-sm font-medium">{L.message}</label>
        <textarea id="q-msg" name="message" rows={3} defaultValue={L.messageDefault} className={input} />
      </div>
      {/* Honeypot: hidden from people, bots fill it in */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="q-web">Web</label>
        <input id="q-web" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="consent" value="1" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]" />
        <span>{fmt(L.consent, { org: orgName })} <a href={privacyHref} target="_blank" className="font-medium text-brand underline">{L.privacyLink}</a>.</span>
      </label>
      {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
      <button type="submit" disabled={state === "sending"} className="w-full rounded-lg bg-brand px-4 py-3 font-semibold text-brand-fg disabled:opacity-60">
        {state === "sending" ? L.sending : L.send}
      </button>
    </form>
  );
}
