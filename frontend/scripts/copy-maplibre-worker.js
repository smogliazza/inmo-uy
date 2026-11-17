#!/usr/bin/env node
/**
 * MapLibre GL looks for its web worker next to its own module, which does not exist once bundled. Copy the
 * worker into public/ (versioned path, so browsers never mix versions) and point setWorkerUrl() at it
 * (src/lib/maplibre.ts). Runs before `next build` and `next dev`; the copy is not committed.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");

const pkg = require("maplibre-gl/package.json");
const src = path.join(path.dirname(require.resolve("maplibre-gl/package.json")), "dist", "maplibre-gl-worker.mjs");
const dir = path.join(__dirname, "..", "public", "maplibre");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(src, path.join(dir, `maplibre-gl-worker-${pkg.version}.mjs`));
console.log(`maplibre worker ${pkg.version} → public/maplibre/`);
