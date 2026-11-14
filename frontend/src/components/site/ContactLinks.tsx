"use client";
import { track, waLink } from "@/lib/site/client";
import { formatPhoneUY } from "@/lib/catalogs";
import { IconPhone, IconWhatsApp, IconMail } from "./icons";

interface Props { api: string; slug: string; propertyId?: string }

/** WhatsApp button with the message already written; every click is recorded. */
export function WhatsAppButton({ api, slug, propertyId, phone, message, label, floating = false }: Props & { phone: string; message: string; label: string; floating?: boolean }) {
  const cls = floating
    ? "fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-3 font-semibold text-[#0b3d1f] shadow-lg hover:brightness-95"
    : "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 py-3 font-semibold text-[#0b3d1f] hover:brightness-95";
  return (
    <a href={waLink(phone, message)} target="_blank" rel="noopener" className={cls} onClick={() => track(api, slug, "whatsapp_click", propertyId)}>
      <IconWhatsApp width={22} height={22} />
      <span className={floating ? "hidden sm:inline" : ""}>{label}</span>
      {floating && <span className="sr-only sm:hidden">{label}</span>}
    </a>
  );
}

export function PhoneLink({ api, slug, propertyId, phone, label, className = "" }: Props & { phone: string; label?: string; className?: string }) {
  return (
    <a href={`tel:${phone}`} className={`inline-flex items-center gap-2 ${className}`} onClick={() => track(api, slug, "phone_click", propertyId)}>
      <IconPhone width={18} height={18} /> {label ?? formatPhoneUY(phone)}
    </a>
  );
}

export function EmailLink({ api, slug, email, className = "" }: Props & { email: string; className?: string }) {
  return (
    <a href={`mailto:${email}`} className={`inline-flex items-center gap-2 ${className}`} onClick={() => track(api, slug, "email_click")}>
      <IconMail width={18} height={18} /> {email}
    </a>
  );
}
