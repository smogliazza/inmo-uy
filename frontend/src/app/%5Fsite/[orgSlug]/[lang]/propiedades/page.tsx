// /propiedades — every public listing with instant filters (state in the URL: ?op=venta&tipo=casa&dorm=3)
import type { Metadata } from "next";
import { siteContext, type SiteParams } from "@/lib/site/context";
import { absoluteUrl } from "@/lib/site/server";
import ListingsPage from "@/components/site/ListingsPage";

// The first page is rendered with the filters of the URL (the index itself comes from the 60 s data cache)
export const dynamic = "force-dynamic";

type Props = SiteParams & { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { site, S } = await siteContext(params);
  return { title: S.meta.list, alternates: { canonical: absoluteUrl(site, "/propiedades") } };
}

export default async function Page({ params, searchParams }: Props) {
  const ctx = await siteContext(params);
  return <ListingsPage ctx={ctx} title={ctx.S.meta.list} path="/propiedades" query={await searchParams} />;
}
