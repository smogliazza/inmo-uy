"use client";
// /favoritos: the listings saved in this browser, taken from the public index
import { useEffect, useMemo, useState } from "react";
import type { SiteStrings } from "@/lib/site/context";
import type { IndexItem } from "@/lib/site/types";
import { fmt } from "@/lib/site/format";
import { onFavoritesChange, readFavorites } from "@/lib/site/client";
import ListingCard from "./ListingCard";

export default function FavoritesList({ items, S, locale, base, slug }: { items: IndexItem[]; S: SiteStrings; locale: string; base: string; slug: string }) {
  const [ids, setIds] = useState<string[] | null>(null);
  useEffect(() => {
    const sync = () => setIds(readFavorites(slug));
    sync();
    return onFavoritesChange(sync);
  }, [slug]);
  const byId = useMemo(() => new Map(items.map(x => [x.i, x])), [items]);
  if (ids === null) return <div className="h-40" />;
  const found = ids.map(id => byId.get(id)).filter((x): x is IndexItem => !!x);
  const gone = ids.length - found.length;
  return (
    <>
      {found.length === 0
        ? <p className="rounded-2xl bg-slate-50 p-8 text-center text-slate-700">{S.fav.empty}</p>
        : <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {found.map(x => <li key={x.i}><ListingCard item={x} S={S} locale={locale} base={base} slug={slug} /></li>)}
          </ul>}
      {gone > 0 && <p className="mt-4 text-sm text-slate-600">{fmt(S.fav.gone, { n: gone })}</p>}
      <p className="mt-6 text-xs text-slate-500">{S.fav.note}</p>
    </>
  );
}
