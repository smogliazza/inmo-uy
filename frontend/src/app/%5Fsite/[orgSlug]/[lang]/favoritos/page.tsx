// /favoritos — favourites kept in the visitor's browser (spec 8.1)
import type { Metadata } from "next";
import { siteContext, type SiteParams } from "@/lib/site/context";
import { getIndex } from "@/lib/site/server";
import FavoritesList from "@/components/site/FavoritesList";

export const revalidate = 60; // seconds (REVALIDATE in lib/site/server.ts)
export async function generateStaticParams() { return []; } // built on the first visit, then refreshed every 60 s

export async function generateMetadata({ params }: SiteParams): Promise<Metadata> {
  const { S } = await siteContext(params);
  return { title: S.fav.title, robots: { index: false, follow: true } };
}

export default async function Favorites({ params }: SiteParams) {
  const ctx = await siteContext(params);
  const items = await getIndex(ctx.site.slug);
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold tracking-tight md:text-3xl">{ctx.S.fav.title}</h1>
      <FavoritesList items={items} S={ctx.S} locale={ctx.locale} base={ctx.base} slug={ctx.site.slug} />
    </div>
  );
}
