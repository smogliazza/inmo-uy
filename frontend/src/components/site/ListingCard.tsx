// Card of one listing (home page, listings, favourites). No hooks: it renders on the server and in the browser.
import Link from "next/link";
import { preload } from "react-dom";
import type { SiteStrings } from "@/lib/site/context";
import type { IndexItem } from "@/lib/site/types";
import { areaOf, fmt, formatIndexPrice, formatNumber, placeOf } from "@/lib/site/format";
import FavButton from "./FavButton";
import { IconArea, IconBath, IconBed } from "./icons";

export const listingHref = (base: string, x: Pick<IndexItem, "c" | "i" | "s">) => `${base}/propiedades/${encodeURIComponent(x.c || x.i)}-${x.s}`;

export default function ListingCard({ item: x, S, locale, base, slug, priority = false, onHover }: {
  item: IndexItem; S: SiteStrings; locale: string; base: string; slug: string; priority?: boolean;
  onHover?: (id: string | null) => void;
}) {
  const type = (x.t && S.types[x.t]) || "";
  const title = x.ti || [type, x.p[0] ? S.opIn[x.p[0][0]] : ""].filter(Boolean).join(" ");
  const area = areaOf(x, locale, S.card);
  const status = S.status[x.st as keyof typeof S.status];
  // The first photos are the largest paint of the page: announce them in <head> (spec 1.2, LCP < 2,5 s)
  if (priority && x.ph) preload(x.ph, { as: "image", fetchPriority: "high" });
  return (
    <article
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
      onMouseEnter={onHover ? () => onHover(x.i) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
    >
      <div className="relative aspect-[4/3] bg-slate-100">
        {x.ph
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={x.ph} alt={title} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding={priority ? "sync" : "async"} width={400} height={300} className="h-full w-full object-cover" />
          : <div className="flex h-full items-center justify-center text-sm text-slate-600">{S.card.noPhoto}</div>}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {x.f && <span className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-semibold text-brand-fg">{S.card.featured}</span>}
          {status && <span className="rounded-full bg-white/95 px-2.5 py-0.5 text-xs font-semibold text-slate-800">{status}</span>}
        </div>
        <FavButton slug={slug} id={x.i} labels={S.fav} className="absolute right-3 top-3 z-10" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="space-y-0.5">
          {x.p.map(p => (
            <p key={p[0]} className="text-lg font-bold leading-tight text-slate-900">
              <span className="sr-only">{S.ops[p[0]]}: </span>{formatIndexPrice(p, locale, S)}
              {x.p.length > 1 && <span className="ml-2 align-middle text-xs font-medium uppercase tracking-wide text-slate-600">{S.ops[p[0]]}</span>}
            </p>
          ))}
        </div>
        <h3 className="line-clamp-2 font-medium text-slate-800">
          <Link href={listingHref(base, x)} className="after:absolute after:inset-0 after:content-['']">{title}</Link>
        </h3>
        <p className="text-sm text-slate-600">{placeOf(x)}</p>
        <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-2 text-sm text-slate-700">
          {x.bd ? <li className="inline-flex items-center gap-1"><IconBed width={16} height={16} />{fmt(S.card.beds, { n: formatNumber(x.bd, locale) })}</li> : null}
          {x.ba ? <li className="inline-flex items-center gap-1"><IconBath width={16} height={16} />{x.ba === 1 ? S.card.bath1 : fmt(S.card.baths, { n: formatNumber(x.ba, locale) })}</li> : null}
          {area && <li className="inline-flex items-center gap-1"><IconArea width={16} height={16} />{area}</li>}
          {x.c && <li className="ml-auto text-xs text-slate-500">{fmt(S.card.code, { code: x.c })}</li>}
        </ul>
      </div>
    </article>
  );
}
