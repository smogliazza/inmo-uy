// Header of a brokerage site: logo, menu (a <details> on phones, no JavaScript) and language switch.
import Link from "next/link";
import type { SiteContext } from "@/lib/site/context";
import LanguageSwitch from "./LanguageSwitch";
import { IconMenu } from "./icons";

export default function SiteHeader({ ctx }: { ctx: SiteContext }) {
  const { site, S, base, lang } = ctx;
  const links = [
    { href: `${base}/propiedades`, label: S.nav.properties },
    { href: `${base}/venta`, label: S.nav.sale },
    { href: `${base}/alquiler`, label: S.nav.rent },
    ...site.config.pages.slice(0, 4).map(p => ({ href: `${base}/p/${p.slug}`, label: p.title })),
    { href: `${base}/favoritos`, label: S.nav.favorites },
    { href: "#contacto", label: S.nav.contact },
  ];
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-white focus:px-3 focus:py-2">{S.nav.skip}</a>
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
        <Link href={`${base}/`} className="flex min-w-0 items-center gap-3 font-semibold text-slate-900">
          {site.logoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={site.logoUrl} alt={site.name} className="h-10 w-auto max-w-[180px] object-contain" />
            : <span className="truncate text-lg">{site.name}</span>}
        </Link>
        <nav aria-label={S.nav.menu} className="ml-auto hidden items-center gap-5 text-sm font-medium text-slate-700 lg:flex">
          {links.map(l => <Link key={l.href} href={l.href} className="hover:text-brand">{l.label}</Link>)}
        </nav>
        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <LanguageSwitch current={lang} label={S.nav.language} />
          <details className="relative lg:hidden">
            <summary className="flex cursor-pointer list-none items-center rounded-md p-2 hover:bg-slate-100" aria-label={S.nav.menu}>
              <IconMenu />
            </summary>
            <nav aria-label={S.nav.menu} className="absolute right-0 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              {links.map(l => <Link key={l.href} href={l.href} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-100">{l.label}</Link>)}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
