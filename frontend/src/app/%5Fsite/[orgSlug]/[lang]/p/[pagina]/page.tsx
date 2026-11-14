// /p/{page} — content pages from siteConfig (about us, services…) and the privacy policy (spec 8.1 / 13)
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { siteContext, type SiteContext, type SiteParams } from "@/lib/site/context";
import { absoluteUrl } from "@/lib/site/server";
import { fmt } from "@/lib/site/format";

export const revalidate = 60; // seconds (REVALIDATE in lib/site/server.ts)
export async function generateStaticParams() { return []; }

type Props = { params: Promise<{ orgSlug: string; lang: string; pagina: string }> };

function pageOf(ctx: SiteContext, slug: string): { title: string; body: string } | null {
  const { site, S } = ctx;
  if (slug === "privacidad") {
    const c = site.config;
    // Without its own text the brokerage gets the template (to be reviewed by a local professional)
    const body = c.privacyPolicy || fmt(S.privacy.body, {
      org: site.name,
      email: c.email || S.privacy.noEmail,
      address: site.address ? fmt(S.privacy.contactAddress, { address: site.address }) : "",
    });
    return { title: S.privacy.title, body };
  }
  return site.config.pages.find(p => p.slug === slug) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await siteContext(params as SiteParams["params"]);
  const { pagina } = await params;
  const page = pageOf(ctx, pagina);
  if (!page) return {};
  return { title: page.title, alternates: { canonical: absoluteUrl(ctx.site, `/p/${pagina}`) } };
}

export default async function ContentPage({ params }: Props) {
  const ctx = await siteContext(params as SiteParams["params"]);
  const { pagina } = await params;
  const page = pageOf(ctx, pagina);
  if (!page) notFound();
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">{page.title}</h1>
      {/* Plain text with paragraphs: no HTML from the settings reaches the page */}
      <div className="mt-6 space-y-4 leading-relaxed text-slate-800">
        {page.body.split(/\n{2,}/).map((para, i) => <p key={i} className="whitespace-pre-line">{para}</p>)}
      </div>
    </div>
  );
}
