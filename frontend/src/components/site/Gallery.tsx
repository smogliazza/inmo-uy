"use client";
// Photo gallery of a listing: main photo with arrows, thumbnails and a full-screen view (Esc / ← →).
// WebP variants through srcset; the first photo loads with high priority, the rest lazily.
import { useCallback, useEffect, useState } from "react";
import { preload } from "react-dom";
import type { ListingPhoto } from "@/lib/site/types";
import { fmt, srcSet } from "@/lib/site/format";
import { IconChevron, IconClose } from "./icons";

export default function Gallery({ photos, alt, labels }: { photos: ListingPhoto[]; alt: string; labels: { prev: string; next: string; close: string; photoOf: string; openGallery: string; noPhoto: string } }) {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);
  const n = photos.length;
  const go = useCallback((d: number) => setI(x => (x + d + n) % n), [n]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, go]);

  // The first photo is the largest paint of the page: announce it in <head>
  if (n) preload(photos[0].md || photos[0].url, { as: "image", fetchPriority: "high", imageSrcSet: srcSet(photos[0]), imageSizes: "(min-width: 1024px) 66vw, 100vw" });
  if (!n) return <div className="flex aspect-[16/10] items-center justify-center rounded-2xl bg-slate-100 text-slate-600">{labels.noPhoto}</div>;
  const p = photos[i];
  const arrow = (d: number, cls: string) => (
    <button type="button" onClick={e => { e.stopPropagation(); go(d); }} aria-label={d < 0 ? labels.prev : labels.next}
      className={`absolute top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-slate-900 shadow hover:bg-white ${cls}`}>
      <IconChevron dir={d < 0 ? "left" : "right"} />
    </button>
  );

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl bg-slate-100">
        <button type="button" onClick={() => setOpen(true)} className="block w-full" aria-label={labels.openGallery}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={p.md || p.url} srcSet={srcSet(p)} sizes="(min-width: 1024px) 66vw, 100vw"
            alt={p.caption || (n > 1 ? `${alt} — ${fmt(labels.photoOf, { i: i + 1, n })}` : alt)}
            width={p.width || 1024} height={p.height || 640}
            loading={i === 0 ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : "auto"} decoding={i === 0 ? "sync" : "async"}
            className="aspect-[16/10] w-full object-cover"
          />
        </button>
        {n > 1 && <>{arrow(-1, "left-3")}{arrow(1, "right-3")}</>}
        {n > 1 && <span className="absolute bottom-3 right-3 rounded-full bg-slate-900/75 px-2.5 py-1 text-xs font-medium text-white">{fmt(labels.photoOf, { i: i + 1, n })}</span>}
      </div>
      {n > 1 && (
        <ul className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {photos.map((ph, k) => (
            <li key={k} className="shrink-0">
              <button type="button" onClick={() => setI(k)} aria-label={fmt(labels.photoOf, { i: k + 1, n })} aria-current={k === i}
                className={`block overflow-hidden rounded-lg border-2 ${k === i ? "border-brand" : "border-transparent opacity-80 hover:opacity-100"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ph.thumb || ph.url} alt="" loading="lazy" decoding="async" width={96} height={64} className="h-16 w-24 object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95" role="dialog" aria-modal="true" aria-label={alt} onClick={() => setOpen(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.lg || p.md || p.url} alt={p.caption || alt} className="max-h-[90vh] max-w-[95vw] object-contain" onClick={e => e.stopPropagation()} />
          <button type="button" onClick={() => setOpen(false)} aria-label={labels.close} className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-slate-900"><IconClose /></button>
          {n > 1 && <>{arrow(-1, "left-4")}{arrow(1, "right-4")}</>}
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white/80">{fmt(labels.photoOf, { i: i + 1, n })}</span>
        </div>
      )}
    </div>
  );
}
