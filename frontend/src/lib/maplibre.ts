// Loads MapLibre GL with its web worker served from public/maplibre/ (copied by scripts/copy-maplibre-worker.js):
// bundled, the library cannot find the worker next to itself. The version is set in next.config.ts.
export async function loadMaplibre() {
  const ml = await import("maplibre-gl");
  if (typeof window !== "undefined") ml.setWorkerUrl(`${window.location.origin}/maplibre/maplibre-gl-worker-${process.env.NEXT_PUBLIC_MAPLIBRE_VERSION}.mjs`);
  return ml;
}
