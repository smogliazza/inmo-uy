/**
 * Geocoding for the panel and the importer (spec 3.1 / 8.3): Nominatim, at most 1 request per second
 * for the whole API, with an identifiable User-Agent and an in-memory cache. Only used from the panel,
 * never from the public site.
 *
 *   NOMINATIM_URL          default https://nominatim.openstreetmap.org
 *   GEOCODER_USER_AGENT    e.g. "inmo-uy/1.0 (ops@your-domain.uy)" (Nominatim's policy asks for a contact)
 */

export interface GeocodeResult { lat: number; lng: number; label: string; precision: 'EXACT' | 'APPROX' }

const BASE = () => (process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
const UA = () => process.env.GEOCODER_USER_AGENT || 'inmo-uy-platform/1.0';

const cache = new Map<string, { at: number; results: GeocodeResult[] }>();
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
let lastCall = 0;
let queue: Promise<void> = Promise.resolve();

// Serializes calls so there is always at least one second between two requests to Nominatim
function throttle(): Promise<void> {
    const next = queue.then(async () => {
        const wait = lastCall + 1000 - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        lastCall = Date.now();
    });
    queue = next.catch(() => {});
    return next;
}

export async function geocode(query: string, opts: { countryCodes?: string; limit?: number } = {}): Promise<GeocodeResult[]> {
    const q = query.trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!q) return [];
    const key = `${opts.countryCodes ?? 'uy'}|${q.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.results;

    await throttle();
    const url = new URL(`${BASE()}/search`);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', String(Math.min(5, opts.limit ?? 5)));
    url.searchParams.set('countrycodes', opts.countryCodes ?? 'uy');
    url.searchParams.set('accept-language', 'es');
    const res = await fetch(url, { headers: { 'User-Agent': UA(), Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Geocoder answered ${res.status}`);
    const rows = await res.json() as { lat: string; lon: string; display_name: string; addresstype?: string; type?: string }[];
    const results = rows.map(r => ({
        lat: Number(r.lat), lng: Number(r.lon), label: r.display_name,
        // A house number or building is exact; a street, neighbourhood or town is only approximate
        precision: (['house', 'building', 'house_number'].includes(r.addresstype ?? r.type ?? '') ? 'EXACT' : 'APPROX') as GeocodeResult['precision'],
    })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));
    cache.set(key, { at: Date.now(), results });
    if (cache.size > 2000) cache.delete(cache.keys().next().value!);
    return results;
}
