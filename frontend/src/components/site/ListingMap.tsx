"use client";
// Map of one listing: the library (~250 KB) is downloaded only when the map is about to scroll into view
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { MapPoint } from "./SiteMap";

const SiteMap = dynamic(() => import("./SiteMap"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-2xl bg-slate-100" /> });

export default function ListingMap(props: { point: MapPoint; brand: string; labels: { searchArea: string; approx: string; unavailable: string } }) {
  const box = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") { setShow(true); return; }
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setShow(true); io.disconnect(); } }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={box} className="h-72">
      {show ? <SiteMap points={[props.point]} brand={props.brand} single labels={props.labels} className="h-72" /> : <div className="h-full w-full rounded-2xl bg-slate-100" />}
    </div>
  );
}
