// /venta — shortcut with the operation already chosen (static page for search engines)
import type { Metadata } from "next";
import { siteContext, type SiteParams } from "@/lib/site/context";
import { absoluteUrl } from "@/lib/site/server";
import ListingsPage from "@/components/site/ListingsPage";

export const revalidate = 60; // seconds (REVALIDATE in lib/site/server.ts)
export async function generateStaticParams() { return []; } // built on the first visit, then refreshed every 60 s

export async function generateMetadata({ params }: SiteParams): Promise<Metadata> {
  const { site, S } = await siteContext(params);
  return { title: S.meta.sale, alternates: { canonical: absoluteUrl(site, "/venta") } };
}

export default async function Page({ params }: SiteParams) {
  const ctx = await siteContext(params);
  return <ListingsPage ctx={ctx} title={ctx.S.meta.sale} path="/venta" op="SALE" />;
}
