/**
 * Geocoder unit test against a local stand-in for Nominatim (no network needed).
 *   npm run test:unit
 */
import assert from 'node:assert/strict';
import http from 'node:http';

async function main() {
    const hits: { at: number; ua: string | undefined; q: string | null }[] = [];
    const server = http.createServer((req, res) => {
        const url = new URL(req.url!, 'http://x');
        hits.push({ at: Date.now(), ua: req.headers['user-agent'], q: url.searchParams.get('q') });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify([
            { lat: '-31.3833', lon: '-57.9667', display_name: 'Uruguay 1234, Salto', addresstype: 'house' },
            { lat: '-31.39', lon: '-57.96', display_name: 'Salto', addresstype: 'city' },
        ]));
    });
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    process.env.NOMINATIM_URL = `http://127.0.0.1:${port}`;
    process.env.GEOCODER_USER_AGENT = 'inmo-uy-test/1.0 (test@example.com)';
    const { geocode } = await import('../src/lib/geocode');

    const r = await geocode('  Uruguay   1234, Salto ');
    assert.equal(r.length, 2);
    assert.deepEqual(r[0], { lat: -31.3833, lng: -57.9667, label: 'Uruguay 1234, Salto', precision: 'EXACT' });
    assert.equal(r[1].precision, 'APPROX');
    assert.equal(hits[0].ua, 'inmo-uy-test/1.0 (test@example.com)', 'identifiable User-Agent');
    assert.equal(hits[0].q, 'Uruguay 1234, Salto', 'query normalized');
    console.log('  ✓ results, precision and User-Agent');

    await geocode('uruguay 1234, salto');
    assert.equal(hits.length, 1, 'cached (case-insensitive)');
    console.log('  ✓ cache');

    await Promise.all([geocode('Artigas 1'), geocode('Artigas 2'), geocode('Artigas 3')]);
    assert.equal(hits.length, 4);
    for (let i = 2; i < hits.length; i++) assert.ok(hits[i].at - hits[i - 1].at >= 950, `at most 1 request per second (gap ${hits[i].at - hits[i - 1].at} ms)`);
    console.log('  ✓ 1 request per second');

    server.close();
    console.log('\nAll geocoder tests passed.');
}

main().catch(err => { console.error(err); process.exit(1); });
