"use client";

import React from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MlMap, Marker as MlMarker } from "maplibre-gl";

/**
 * Map to place a listing's pin (MapLibre GL + OpenFreeMap by default, no API key).
 * Click the map or drag the pin. Loaded lazily (next/dynamic, ssr: false) only when the Location tab opens.
 */
const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";
const URUGUAY_CENTER: [number, number] = [-56.0, -32.6]; // lng, lat

export default function LocationPicker({ lat, lng, onChange, onError }: {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
  onError?: () => void;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const map = React.useRef<MlMap | null>(null);
  const marker = React.useRef<MlMarker | null>(null);
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // Create the map once
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        if (cancelled || !box.current) return;
        const m = new maplibre.Map({
          container: box.current,
          style: STYLE_URL,
          center: lat !== null && lng !== null ? [lng, lat] : URUGUAY_CENTER,
          zoom: lat !== null && lng !== null ? 15 : 5.5,
          attributionControl: { compact: true },
        });
        m.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        const mk = new maplibre.Marker({ draggable: true, color: "#B8977E" });
        if (lat !== null && lng !== null) mk.setLngLat([lng, lat]).addTo(m);
        mk.on("dragend", () => { const p = mk.getLngLat(); onChangeRef.current(round(p.lat), round(p.lng)); });
        m.on("click", (e: { lngLat: { lat: number; lng: number } }) => {
          mk.setLngLat(e.lngLat).addTo(m);
          onChangeRef.current(round(e.lngLat.lat), round(e.lngLat.lng));
        });
        m.on("error", () => onError?.());
        map.current = m;
        marker.current = mk;
      } catch {
        onError?.();
      }
    })();
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow coordinates typed in the inputs or picked from the address search
  React.useEffect(() => {
    const m = map.current, mk = marker.current;
    if (!m || !mk) return;
    if (lat === null || lng === null) { mk.remove(); return; }
    const cur = mk.getLngLat?.();
    if (!cur || Math.abs(cur.lat - lat) > 1e-6 || Math.abs(cur.lng - lng) > 1e-6) {
      mk.setLngLat([lng, lat]).addTo(m);
      m.easeTo({ center: [lng, lat], zoom: Math.max(m.getZoom(), 15) });
    }
  }, [lat, lng]);

  return <div ref={box} className="w-full h-72 rounded-xl overflow-hidden border border-border/60 bg-surface" />;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
