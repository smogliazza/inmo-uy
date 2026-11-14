"use client";
// Map of the public site (spec 8.3): MapLibre GL + OpenFreeMap (NEXT_PUBLIC_MAP_STYLE_URL can change provider).
// Loaded only when shown (next/dynamic, ssr: false). Fed from the same filtered index as the list, with clusters.
// EXACT listings show a pin; APPROX ones a ~300 m circle around a shifted centre; HIDDEN ones never get here.
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from "maplibre-gl";
import { loadMaplibre } from "@/lib/maplibre";

export interface MapPoint { id: string; lat: number; lng: number; approx: boolean; title: string; price: string; href: string }

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";
const URUGUAY: [[number, number], [number, number]] = [[-58.5, -35.0], [-53.0, -30.0]];

// Pixels for 300 m at a given zoom (latitude of Uruguay): 300 / (156543 · cos(−33°) / 2^z)
const meters = (m: number, z: number) => m / (156543.03 * Math.cos((33 * Math.PI) / 180) / 2 ** z);

function toGeoJSON(points: MapPoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map(p => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { id: p.id, approx: p.approx ? 1 : 0, title: p.title, price: p.price, href: p.href },
    })),
  };
}

export default function SiteMap({ points, brand, hoverId, single = false, labels, onSearchArea, className = "" }: {
  points: MapPoint[];
  brand: string;
  hoverId?: string | null;
  single?: boolean;
  labels: { searchArea: string; approx: string; unavailable: string };
  onSearchArea?: (bbox: [number, number, number, number]) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const userMoved = useRef(false);
  const latest = useRef(points);
  const [failed, setFailed] = useState(false);
  const [moved, setMoved] = useState(false);
  const onSearchRef = useRef(onSearchArea);
  useEffect(() => { onSearchRef.current = onSearchArea; }, [onSearchArea]);

  const fit = (m: MlMap, pts: MapPoint[]) => {
    if (!pts.length) return;
    if (single || pts.length === 1) { m.jumpTo({ center: [pts[0].lng, pts[0].lat], zoom: pts[0].approx ? 14 : 15 }); return; }
    let [w, s, e, n] = [180, 90, -180, -90];
    for (const p of pts) { w = Math.min(w, p.lng); e = Math.max(e, p.lng); s = Math.min(s, p.lat); n = Math.max(n, p.lat); }
    m.fitBounds([[w, s], [e, n]], { padding: 48, maxZoom: 15, duration: 0 });
  };

  // Create the map once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ml = await loadMaplibre();
        if (cancelled || !box.current) return;
        const m = new ml.Map({
          container: box.current, style: STYLE_URL, bounds: URUGUAY, attributionControl: { compact: true },
          cooperativeGestures: single, dragRotate: false, pitchWithRotate: false,
        });
        map.current = m;
        m.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
        m.on("error", e => { if (!ready.current && /style|webgl/i.test(String(e?.error?.message || ""))) setFailed(true); });
        m.on("load", () => {
          m.addSource("listings", { type: "geojson", data: toGeoJSON(latest.current), cluster: !single, clusterRadius: 48, clusterMaxZoom: 14 });
          m.addLayer({ id: "clusters", type: "circle", source: "listings", filter: ["has", "point_count"],
            paint: { "circle-color": brand, "circle-opacity": 0.9, "circle-stroke-color": "#fff", "circle-stroke-width": 2,
              "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 26] } });
          m.addLayer({ id: "cluster-count", type: "symbol", source: "listings", filter: ["has", "point_count"],
            layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 13, "text-font": ["Noto Sans Bold"] },
            paint: { "text-color": "#fff" } });
          m.addLayer({ id: "approx", type: "circle", source: "listings", filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "approx"], 1]],
            paint: { "circle-color": brand, "circle-opacity": 0.18, "circle-stroke-color": brand, "circle-stroke-width": 1.5,
              "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 8, meters(300, 8), 18, meters(300, 18)] } });
          m.addLayer({ id: "points", type: "circle", source: "listings", filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "approx"], 0]],
            paint: { "circle-color": brand, "circle-radius": 7, "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
          m.addLayer({ id: "hover", type: "circle", source: "listings", filter: ["==", ["get", "id"], ""],
            paint: { "circle-color": "#fff", "circle-radius": 10, "circle-stroke-color": brand, "circle-stroke-width": 4 } });
          ready.current = true;
          fit(m, latest.current);

          m.on("click", "clusters", async (e: MapMouseEvent & { features?: GeoJSON.Feature[] }) => {
            const f = e.features?.[0];
            if (!f || f.geometry.type !== "Point") return;
            const zoom = await (m.getSource("listings") as GeoJSONSource).getClusterExpansionZoom(f.properties?.cluster_id);
            m.easeTo({ center: f.geometry.coordinates as [number, number], zoom });
          });
          const popup = (e: MapMouseEvent & { features?: GeoJSON.Feature[] }) => {
            const f = e.features?.[0];
            if (!f || f.geometry.type !== "Point" || single) return;
            const p = f.properties as { title: string; price: string; href: string; approx: number };
            const el = document.createElement("a");
            el.href = p.href;
            el.className = "block px-3 py-2 text-sm";
            const price = document.createElement("strong");
            price.textContent = p.price;
            const title = document.createElement("span");
            title.className = "block text-slate-700";
            title.textContent = p.title;
            el.append(price, title);
            if (p.approx) { const a = document.createElement("span"); a.className = "block text-xs text-slate-500"; a.textContent = labels.approx; el.append(a); }
            new ml.Popup({ closeButton: false, offset: 12 }).setLngLat(f.geometry.coordinates as [number, number]).setDOMContent(el).addTo(m);
          };
          m.on("click", "points", popup);
          m.on("click", "approx", popup);
          for (const id of ["clusters", "points", "approx"]) {
            m.on("mouseenter", id, () => { m.getCanvas().style.cursor = "pointer"; });
            m.on("mouseleave", id, () => { m.getCanvas().style.cursor = ""; });
          }
          m.on("dragend", () => { userMoved.current = true; setMoved(true); });
          m.on("zoomend", e => { if ((e as { originalEvent?: unknown }).originalEvent) { userMoved.current = true; setMoved(true); } });
        });
      } catch {
        setFailed(true);
      }
    })();
    return () => { cancelled = true; map.current?.remove(); map.current = null; ready.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Same data as the list: refresh the source, and re-frame unless the visitor moved the map
  useEffect(() => {
    latest.current = points;
    const m = map.current;
    if (!m || !ready.current) return;
    (m.getSource("listings") as GeoJSONSource | undefined)?.setData(toGeoJSON(points));
    if (!userMoved.current) fit(m, points);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  useEffect(() => {
    const m = map.current;
    if (m && ready.current && m.getLayer("hover")) m.setFilter("hover", ["==", ["get", "id"], hoverId || ""]);
  }, [hoverId]);

  if (failed) return <div className={`flex items-center justify-center rounded-2xl bg-slate-100 p-6 text-center text-sm text-slate-600 ${className}`}>{labels.unavailable}</div>;

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-slate-100 ${className}`}>
      <div ref={box} className="h-full w-full" />
      {onSearchArea && moved && (
        <button
          type="button"
          onClick={() => {
            const b = map.current?.getBounds();
            if (!b) return;
            onSearchRef.current?.([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
            setMoved(false);
          }}
          className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-md hover:bg-slate-50"
        >
          {labels.searchArea}
        </button>
      )}
    </div>
  );
}
