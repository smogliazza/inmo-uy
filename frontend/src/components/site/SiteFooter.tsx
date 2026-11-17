// Footer of a brokerage site: contact details (anchor #contacto), social links, pages and privacy policy.
import Link from "next/link";
import type { SiteContext } from "@/lib/site/context";
import { fmt } from "@/lib/site/format";
import { PhoneLink, EmailLink } from "./ContactLinks";
import { IconPin, IconClock, IconSocial, IconWhatsApp } from "./icons";
import { formatPhoneUY } from "@/lib/catalogs";
import { waLink } from "@/lib/site/client";

export default function SiteFooter({ ctx }: { ctx: SiteContext }) {
  const { site, S, base, api } = ctx;
  const c = site.config;
  const social = Object.entries(c.social).filter(([, u]) => !!u);
  return (
    <footer id="contacto" className="mt-16 border-t border-slate-200 bg-slate-50">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 md:grid-cols-3">
        <div>
          <p className="text-lg font-semibold">{site.name}</p>
          <ul className="mt-4 space-y-2 text-sm text-slate-700">
            {site.address && <li className="flex gap-2"><IconPin width={18} height={18} className="mt-0.5 shrink-0" /> {site.address}</li>}
            {site.phone && <li><PhoneLink api={api} slug={site.slug} phone={site.phone} className="hover:text-brand" /></li>}
            {site.whatsapp && (
              <li>
                <a href={waLink(site.whatsapp, S.wa.generic)} target="_blank" rel="noopener" className="inline-flex items-center gap-2 hover:text-brand">
                  <IconWhatsApp width={18} height={18} /> {formatPhoneUY(site.whatsapp)}
                </a>
              </li>
            )}
            {c.email && <li><EmailLink api={api} slug={site.slug} email={c.email} className="hover:text-brand" /></li>}
            {c.hours && <li className="flex gap-2"><IconClock width={18} height={18} className="mt-0.5 shrink-0" /> {c.hours}</li>}
          </ul>
        </div>
        <div>
          <p className="font-semibold">{S.footer.pages}</p>
          <ul className="mt-4 space-y-2 text-sm text-slate-700">
            <li><Link href={`${base}/propiedades`} className="hover:text-brand">{S.nav.properties}</Link></li>
            {c.pages.map(p => <li key={p.slug}><Link href={`${base}/p/${p.slug}`} className="hover:text-brand">{p.title}</Link></li>)}
            <li><Link href={`${base}/p/privacidad`} className="hover:text-brand">{S.privacy.title}</Link></li>
          </ul>
        </div>
        {social.length > 0 && (
          <div>
            <p className="font-semibold">{S.footer.social}</p>
            <ul className="mt-4 flex gap-3">
              {social.map(([k, u]) => (
                <li key={k}>
                  <a href={u} target="_blank" rel="noopener" aria-label={k} className="inline-flex rounded-full bg-white p-2 text-slate-700 shadow-sm hover:text-brand">
                    <IconSocial name={k} width={20} height={20} />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <p className="border-t border-slate-200 py-4 text-center text-xs text-slate-600">{fmt(S.footer.rights, { year: new Date().getFullYear(), org: site.name })}</p>
    </footer>
  );
}
