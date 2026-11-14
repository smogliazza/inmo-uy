/**
 * End-to-end API smoke test. Runs against a live server + database.
 *
 *   API_URL=http://localhost:4000 npm run test:smoke
 *
 * Creates two fresh brokerages (unique emails each run) and walks through the
 * main agent workflows, plus checks that one brokerage cannot touch the other's data.
 */
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../src/lib/prisma';
import jwt from 'jsonwebtoken';

const API = process.env.API_URL || 'http://localhost:4000';
const run = Date.now().toString(36);
let passed = 0;

async function call(method: string, path: string, token?: string, body?: unknown) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
}

async function step(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        console.error(`  ✗ ${name}`);
        throw e;
    }
}

async function register(label: string) {
    const r = await call('POST', '/api/auth/register', undefined, {
        name: `${label} Owner`, email: `${label}-${run}@smoke.test`, password: 'SmokeTest123!', orgName: `${label} Realty ${run}`,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.token as string;
}

// Shared database handle for steps that need to create staff accounts or back-date data
let sharedPrisma: PrismaClient | null = null;
const db = () => (sharedPrisma ??= createPrismaClient());

// Invite someone into the owner's brokerage and accept the invitation (needs DATABASE_URL to read the token)
async function joinOrg(owner: string, label: string, role: string) {
    const email = `${label}-${run}@smoke.test`;
    const inv = await call('POST', '/api/settings/invite', owner, { email, role });
    assert.equal(inv.status, 200, JSON.stringify(inv.body));
    const row = await db().invitation.findFirst({ where: { email }, orderBy: { createdAt: 'desc' } });
    assert.ok(row, 'invitation row exists');
    const acc = await call('POST', '/api/auth/accept-invite', undefined, { name: `${label} User`, email, password: 'SmokeTest123!', inviteToken: row!.token });
    assert.equal(acc.status, 201, JSON.stringify(acc.body));
    return { token: acc.body.token as string, id: acc.body.user?.id as string };
}

async function uploadFile(token: string, bytes: Buffer, mime: string, name: string, visibility: 'PUBLIC' | 'PRIVATE') {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name);
    form.append('visibility', visibility);
    const res = await fetch(`${API}/api/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    return { status: res.status, body: await res.json().catch(() => null) as any };
}


// ─── Module system ────────────────────────────────────────────────────────────
// CI runs this suite twice: SMOKE_MODULES=all-on (server with MODULES_DEFAULT_ON = every module) and
// SMOKE_MODULES=optional-off (server with MODULES_DEFAULT_OFF = every module).
const SMOKE_MODULES = process.env.SMOKE_MODULES || 'all-on';

// One list route per gated router, with the module that owns it
const GATED_ROUTES: [string, string][] = [
    ['/api/clients', 'crmLeads'], ['/api/transactions', 'deals'], ['/api/offers', 'deals'],
    ['/api/finance/metrics', 'commissions'], ['/api/documents', 'documents'], ['/api/appointments', 'appointments'],
    ['/api/tasks', 'tasks'], ['/api/marketing-tasks', 'marketing'], ['/api/marketing/skills', 'aiAssistant'],
    ['/api/referrals', 'referrals'], ['/api/gifts', 'gifts'], ['/api/settings/lead-routing', 'leadRouting'],
    ['/api/payments/portal', 'billing'],
];

function assertModuleDisabled(r: { status: number; body: any }, key: string, what: string) {
    assert.equal(r.status, 404, `${what}: expected 404, got ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(r.body?.error, 'module_disabled', what);
    assert.equal(r.body?.module, key, what);
}

const moduleMap = async (token: string) => {
    const r = await call('GET', '/api/settings/modules', token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return Object.fromEntries((r.body.modules as any[]).map(m => [m.key, m])) as Record<string, any>;
};
const setModules = (token: string, modules: Record<string, boolean | null>) => call('PUT', '/api/settings/modules', token, { modules });

/** Every optional module off: the core (listings, dashboard, settings) still works and every gated API answers 404. */
async function optionalOffSuite() {
    console.log(`Smoke test (all optional modules OFF) against ${API}`);
    const a = await register('offalpha');
    const b = await register('offbravo');

    await step('modules: every module is off for a new brokerage', async () => {
        const m = await moduleMap(a);
        assert.equal(Object.keys(m).length, 17);
        for (const [key, state] of Object.entries(m)) assert.equal(state.enabled, false, key);
        const inst = await call('GET', '/api/modules/installation');
        assert.equal(inst.status, 200);
        assert.ok(Object.values(inst.body.modules).every(v => v === false), 'installation view: all off');
    });

    await step('core keeps working: listings, dashboard, search, settings', async () => {
        const p = await call('POST', '/api/properties', a, { propertyType: 'CASA', address: '9 Core St', city: 'Salto', state: 'Salto', zip: '50000', price: 100000, beds: 1, baths: 1 });
        assert.equal(p.status, 201, JSON.stringify(p.body));
        assert.equal((await call('GET', '/api/properties', a)).status, 200);
        assert.equal((await call('GET', '/api/dashboard', a)).status, 200);
        const sr = await call('GET', '/api/search?q=core', a);
        assert.equal(sr.status, 200);
        assert.deepEqual(sr.body.clients, []);
        assert.deepEqual(sr.body.transactions, []);
        assert.equal(sr.body.properties.length, 1);
        assert.equal((await call('GET', '/api/settings/policies', a)).status, 200);
    });

    await step('every gated API answers 404 module_disabled', async () => {
        for (const [path, key] of GATED_ROUTES) assertModuleDisabled(await call('GET', path, a), key, path);
        const org = await call('GET', '/api/settings/organization', a);
        assertModuleDisabled(await call('GET', `/api/properties/public?b=${org.body.slug}`), 'publicSite', 'public listings');
        assertModuleDisabled(await call('GET', `/api/public/site?site=${org.body.slug}`), 'publicSite', 'brokerage site');
        assertModuleDisabled(await call('GET', `/api/public/listings/index?site=${org.body.slug}`), 'publicSite', 'site index');
        assertModuleDisabled(await call('GET', '/api/site-settings', a), 'publicSite', 'site settings');
        assertModuleDisabled(await call('POST', '/api/oauth/google', undefined, { idToken: 'x' }), 'googleOAuth', 'google sign-in');
        // Without AI_ASSISTANT_ENABLED=true the assistant is forced off: no brokerage can turn it on
        const ai = (await moduleMap(a)).aiAssistant;
        assert.equal(ai.source, 'forced_off');
        assert.equal(ai.canEdit, false);
        assert.equal((await setModules(a, { aiAssistant: true })).status, 400);
    });

    await step('turning a module on applies to that brokerage only', async () => {
        const r = await setModules(a, { appointments: true });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal((await call('GET', '/api/appointments', a)).status, 200);
        assertModuleDisabled(await call('GET', '/api/appointments', b), 'appointments', 'other brokerage');
        // commissions needs deals: on its own it stays off and says why
        const c = await setModules(a, { commissions: true });
        const com = (c.body.modules as any[]).find(m => m.key === 'commissions');
        assert.equal(com.enabled, false);
        assert.deepEqual(com.blockedBy, ['deals']);
        assertModuleDisabled(await call('GET', '/api/finance/metrics', a), 'commissions', 'commissions without deals');
    });

    console.log(`\nAll ${passed} smoke checks passed (optional modules off).`);
}

async function main() {
    if (SMOKE_MODULES === 'optional-off') return optionalOffSuite();
    console.log(`Smoke test against ${API}`);

    await step('health check', async () => {
        const r = await call('GET', '/api/health');
        assert.equal(r.status, 200);
        assert.match(String(r.body?.version || ''), /^\d+\.\d+\.\d+\.\d+$/, `expected 4-segment version X.Y.Z.W, got ${r.body?.version}`);
    });

    const a = await register('alpha');
    const b = await register('bravo');
    let clientId = '', propertyId = '', txId = '', offerId = '', apptId = '';

    await step('create listing with validation', async () => {
        const bad = await call('POST', '/api/properties', a, { propertyType: 'CASA', address: '1 Test St', city: 'NYC', state: 'NY', zip: '10001', price: 'abc', beds: 1, baths: 1 });
        assert.equal(bad.status, 400);
        const r = await call('POST', '/api/properties', a, { propertyType: 'CASA', address: '1 Test St', city: 'New York', state: 'NY', zip: '10001', price: 1000000, beds: 2, baths: 2 });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        propertyId = r.body.id;
    });

    await step('create client, detail page, duplicate detection', async () => {
        const r = await call('POST', '/api/clients', a, { firstName: 'Pat', lastName: 'Buyer', email: `pat-${run}@example.com`, phone: '555-0100', source: 'Referral', budget: '$1M' });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        clientId = r.body.id;
        assert.equal(r.body.source, 'Referral');
        const dup = await call('POST', '/api/clients', a, { firstName: 'Pat', lastName: 'Again', email: `PAT-${run}@example.com` });
        assert.equal(dup.status, 409);
        const detail = await call('GET', `/api/clients/${clientId}`, a);
        assert.equal(detail.status, 200);
        assert.equal(detail.body.firstName, 'Pat');
    });

    await step('server-side client search', async () => {
        const r = await call('GET', '/api/clients?q=pat%20buyer', a);
        assert.equal(r.status, 200);
        assert.equal(r.body.total, 1);
        const stale = await call('GET', '/api/clients?stale=true', a);
        assert.equal(stale.body.total, 1, 'never-contacted client should need follow-up');
    });

    await step('log activity updates last contact + timeline', async () => {
        const r = await call('POST', `/api/clients/${clientId}/activities`, a, { type: 'CALL', subject: 'Intro call', content: 'Wants 2BR', followUpDate: new Date(Date.now() + 86400000).toISOString() });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        const t = await call('GET', `/api/clients/${clientId}/timeline`, a);
        assert.ok(t.body.some((e: any) => e.type === 'NOTE'));
        const stale = await call('GET', '/api/clients?stale=true', a);
        assert.equal(stale.body.total, 0);
        const tasks = await call('GET', `/api/tasks?clientId=${clientId}`, a);
        assert.equal(tasks.body.length, 1, 'follow-up task created');
    });

    await step('appointment create / update / delete', async () => {
        const r = await call('POST', '/api/appointments', a, { title: 'Showing', type: 'SHOWING', date: new Date(Date.now() + 3600000).toISOString(), clientId, propertyId });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        apptId = r.body.id;
        const u = await call('PATCH', `/api/appointments/${apptId}`, a, { status: 'CONFIRMED', location: 'Lobby' });
        assert.equal(u.status, 200);
        assert.equal(u.body.status, 'CONFIRMED');
    });

    await step('offer → accept opens a deal with checklist', async () => {
        const r = await call('POST', '/api/offers', a, { amount: 950000, propertyId, clientId });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        offerId = r.body.id;
        const c = await call('PATCH', `/api/offers/${offerId}`, a, { status: 'COUNTER' });
        assert.equal(c.status, 400, 'counter needs an amount');
        const acc = await call('PATCH', `/api/offers/${offerId}`, a, { status: 'ACCEPTED' });
        assert.equal(acc.status, 200, JSON.stringify(acc.body));
        assert.ok(acc.body.transaction, 'deal opened');
        txId = acc.body.transaction.id;
        const tx = await call('GET', `/api/transactions/${txId}`, a);
        assert.ok(tx.body.checklist.length >= 6, 'closing checklist created');
        const prop = await call('GET', `/api/properties/${propertyId}`, a);
        assert.equal(prop.body.status, 'IN_CONTRACT');
    });

    await step('closing a deal creates the commission', async () => {
        const r = await call('PATCH', `/api/transactions/${txId}`, a, { status: 'CLOSED' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.commissions.length, 1);
        // 3% default of $950k, 30% firm split → 28,500 gross, 19,950 net
        assert.equal(r.body.commissions[0].netPayout, 19950);
        const again = await call('PATCH', `/api/transactions/${txId}`, a, { status: 'CLOSED', notes: 'dup check' });
        assert.equal(again.body.commissions.length, 1, 'no duplicate commission');
        const prop = await call('GET', `/api/properties/${propertyId}`, a);
        assert.equal(prop.body.status, 'SOLD');
    });

    await step('solo broker can request and approve own payout', async () => {
        const list = await call('GET', '/api/finance/commissions', a);
        assert.equal(list.status, 200, JSON.stringify(list.body));
        const id = list.body.data[0].id;
        const req = await call('POST', `/api/finance/commissions/${id}/payout`, a);
        assert.equal(req.status, 200, JSON.stringify(req.body));
        // the approval queue must tell the UI a solo broker may review their own request
        const queue = await call('GET', '/api/finance/payout-requests', a);
        assert.equal(queue.status, 200, JSON.stringify(queue.body));
        const queued = queue.body.find((q: any) => q.id === id);
        assert.ok(queued, 'request appears in the approval queue');
        assert.equal(queued.canReview, true, 'sole approver can review their own request');
        const ok = await call('POST', `/api/finance/commissions/${id}/approve`, a);
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.equal(ok.body.status, 'PAID');
    });

    await step('dashboard reflects activity', async () => {
        const r = await call('GET', '/api/dashboard', a);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.chartData.length, 6);
        assert.ok(r.body.ytdCommission >= 19950);
    });

    await step('public listing inquiry creates a HOT lead + urgent task', async () => {
        const p2 = await call('POST', '/api/properties', a, { propertyType: 'CASA', address: '2 Lead Ave', city: 'New York', state: 'NY', zip: '10002', price: 800000, beds: 1, baths: 1 });
        const detail = await call('GET', `/api/properties/public/${p2.body.id}`);
        assert.equal(detail.status, 200);
        assert.equal(detail.body.agent.name, 'alpha Owner');
        const bad = await call('POST', `/api/properties/public/${p2.body.id}/inquiry`, undefined, { name: 'X' });
        assert.equal(bad.status, 400);
        const r = await call('POST', `/api/properties/public/${p2.body.id}/inquiry`, undefined, { name: 'Web Lead', email: `lead-${run}@example.com`, message: 'Is it available?' });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        const leads = await call('GET', '/api/clients?temperature=HOT', a);
        assert.ok(leads.body.data.some((c: any) => c.source === 'Sitio web'));
        const notes = await call('GET', '/api/notifications', a);
        assert.ok(notes.body.notifications.some((n: any) => n.type === 'NEW_CLIENT'));
    });

    await step('gifts and documents with real records', async () => {
        const g = await call('POST', '/api/gifts', a, { item: 'Champagne', clientId });
        assert.equal(g.status, 201, JSON.stringify(g.body));
        const d = await call('POST', '/api/documents', a, { name: 'Contract', url: 'https://example.com/c.pdf', type: 'CONTRACT', transactionId: txId });
        assert.equal(d.status, 201, JSON.stringify(d.body));
        const list = await call('GET', '/api/documents', a);
        assert.equal(list.body.length, 1);
    });

    await step('AI skills catalogue', async () => {
        const r = await call('GET', '/api/marketing/skills', a);
        assert.equal(r.status, 200);
        assert.ok(r.body.skills.length >= 6);
        const gen = await call('POST', '/api/marketing/generate', a, { type: 'LISTING', audience: 'young professionals', features: 'roof deck', language: 'en' });
        assert.equal(gen.status, 200);
        assert.ok(gen.body.generatedContent.length > 50);
    });

    await step('tenant isolation: brokerage B cannot use A’s records', async () => {
        const read = await call('GET', `/api/clients/${clientId}`, b);
        assert.equal(read.status, 404);
        const tx = await call('POST', '/api/transactions', b, { propertyId, clientId, price: 1 });
        assert.equal(tx.status, 400);
        const offer = await call('POST', '/api/offers', b, { propertyId, clientId, amount: 1 });
        assert.equal(offer.status, 400);
        const appt = await call('POST', '/api/appointments', b, { title: 'x', date: new Date().toISOString(), clientId });
        assert.equal(appt.status, 400);
        const doc = await call('POST', '/api/documents', b, { name: 'x', url: 'https://x.y', transactionId: txId });
        assert.equal(doc.status, 400);
        const gift = await call('POST', '/api/gifts', b, { item: 'x', clientId });
        assert.equal(gift.status, 400);
        const patch = await call('PATCH', `/api/transactions/${txId}`, b, { status: 'FALLEN_THROUGH' });
        assert.equal(patch.status, 404);
        const search = await call('GET', '/api/search?q=pat', b);
        assert.equal(search.body.clients.length, 0);
    });

    await step('public listings page is per brokerage', async () => {
        const none = await call('GET', '/api/properties/public');
        assert.equal(none.status, 400);
        const orgA = await call('GET', '/api/settings/organization', a);
        const orgB = await call('GET', '/api/settings/organization', b);
        assert.ok(orgA.body.slug && orgB.body.slug && orgA.body.slug !== orgB.body.slug);
        const pageA = await call('GET', `/api/properties/public?b=${orgA.body.slug}`);
        assert.equal(pageA.status, 200);
        assert.ok(pageA.body.listings.length >= 1);
        const pageB = await call('GET', `/api/properties/public?b=${orgB.body.slug}`);
        assert.equal(pageB.body.listings.length, 0, 'B must not see A listings');
        const missing = await call('GET', '/api/properties/public?b=does-not-exist');
        assert.equal(missing.status, 404);
    });

    await step('social sign-in cannot join an existing brokerage', async () => {
        const apple = await call('POST', '/api/oauth/apple', undefined, { email: `x-${run}@example.com`, appleId: 'fake' });
        assert.equal(apple.status, 503);
        const g = await call('POST', '/api/oauth/google', undefined, { idToken: 'x', email: `g-${run}@example.com`, googleId: `g-${run}` });
        if (g.status === 200) {
            // dev mode only: new social users get their own brokerage
            const me = await call('GET', '/api/settings/organization', g.body.token);
            const orgA = await call('GET', '/api/settings/organization', a);
            assert.notEqual(me.body.id, orgA.body.id);
        } else {
            assert.equal(g.status, 503);
        }
    });

    await step('security basics: password policy, safe links, headers, httpOnly cookie + CSRF', async () => {
        const weak = await call('POST', '/api/auth/register', undefined, { name: 'W', email: `weak-${run}@smoke.test`, password: '123', orgName: 'Weak' });
        assert.equal(weak.status, 400);
        const js = await call('POST', '/api/properties', a, { propertyType: 'CASA', address: '3 Bad Ln', city: 'NY', state: 'NY', zip: '10003', price: 1, beds: 1, baths: 1, virtualTourUrl: 'javascript:alert(1)' });
        assert.equal(js.status, 400);
        const res = await fetch(`${API}/api/health`);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(res.headers.get('x-powered-by'), null);
        const forged = await call('GET', '/api/clients', 'eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOiJ4In0.');
        assert.equal(forged.status, 401, 'unsigned tokens are rejected');

        // Verify httpOnly cookie is issued on login and enforces CSRF header on state-changing requests
        const loginRes = await fetch(`${API}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: `alpha-${run}@smoke.test`, password: 'SmokeTest123!' }),
        });
        assert.equal(loginRes.status, 200);
        const setCookie = loginRes.headers.get('set-cookie') || '';
        assert.ok(setCookie.includes('crm_session=') && setCookie.includes('HttpOnly'), 'login sets httpOnly crm_session cookie');
        const cookiePair = setCookie.split(';')[0];

        // Cookie-only GET works
        const cookieGet = await fetch(`${API}/api/clients`, { headers: { Cookie: cookiePair } });
        assert.equal(cookieGet.status, 200);

        // Cookie-only POST without X-CSRF-Protection is blocked (403)
        const csrfBlocked = await fetch(`${API}/api/clients`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookiePair },
            body: JSON.stringify({ firstName: 'Csrf', lastName: 'Test', email: `csrf-${run}@example.com` }),
        });
        assert.equal(csrfBlocked.status, 403, 'cookie-only POST without CSRF header is rejected');

        // Cookie-only POST with X-CSRF-Protection succeeds (201)
        const csrfAllowed = await fetch(`${API}/api/clients`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookiePair, 'X-CSRF-Protection': '1' },
            body: JSON.stringify({ firstName: 'Csrf', lastName: 'Allowed', email: `csrf-ok-${run}@example.com` }),
        });
        assert.equal(csrfAllowed.status, 201, 'cookie-only POST with X-CSRF-Protection header succeeds');

        // Logout clears the cookie
        const logoutRes = await fetch(`${API}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookiePair, 'X-CSRF-Protection': '1' } });
        assert.equal(logoutRes.status, 200);
        assert.ok((logoutRes.headers.get('set-cookie') || '').includes('crm_session=;'), 'logout clears crm_session cookie');
    });

    await step('real file upload: public listing photos, reordering, private documents & cleanup', async () => {
        // 1x1 transparent PNG
        const pngBytes = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
            'base64',
        );
        const form = new FormData();
        form.append('file', new Blob([pngBytes], { type: 'image/png' }), 'photo1.png');
        form.append('visibility', 'PUBLIC');

        const up1 = await fetch(`${API}/api/uploads`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${a}` },
            body: form,
        });
        assert.equal(up1.status, 201);
        const up1Body = await up1.json();
        assert.ok(up1Body.storageKey && up1Body.url.includes('/api/uploads/public/'));

        // Public image is directly fetchable without auth
        const pubFetch = await fetch(up1Body.url);
        assert.equal(pubFetch.status, 200);
        assert.equal(pubFetch.headers.get('content-type'), 'image/png');

        // Attach photo 1 & photo 2 to listing and test reorder
        const m1 = await call('POST', '/api/media', a, {
            url: up1Body.url,
            storageKey: up1Body.storageKey,
            sizeBytes: up1Body.sizeBytes,
            mimeType: up1Body.mimeType,
            type: 'image',
            propertyId,
        });
        assert.equal(m1.status, 201);

        const m2 = await call('POST', '/api/media', a, {
            url: 'https://example.com/second.jpg',
            type: 'image',
            propertyId,
        });
        assert.equal(m2.status, 201);

        const reordered = await call('PATCH', '/api/media/reorder', a, {
            propertyId,
            orderedIds: [m2.body.id, m1.body.id],
        });
        assert.equal(reordered.status, 200);
        assert.equal(reordered.body[0].id, m2.body.id);

        // Delete media 1 and verify underlying public file is cleaned up
        const delMedia = await call('DELETE', `/api/media/${m1.body.id}`, a);
        assert.equal(delMedia.status, 200);
        const pubAfterDel = await fetch(up1Body.url);
        assert.equal(pubAfterDel.status, 404, 'deleted media cleans up underlying stored file');

        // Private PDF document upload
        const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8');
        const docForm = new FormData();
        docForm.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'contract.pdf');
        docForm.append('visibility', 'PRIVATE');

        const upDoc = await fetch(`${API}/api/uploads`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${a}` },
            body: docForm,
        });
        assert.equal(upDoc.status, 201);
        const upDocBody = await upDoc.json();

        // Raw private URL without signature is rejected (403)
        const rawPriv = await fetch(upDocBody.url);
        assert.equal(rawPriv.status, 403, 'unsigned private file access is rejected');

        const docRec = await call('POST', '/api/documents', a, {
            name: 'Signed Contract.pdf',
            url: upDocBody.url,
            storageKey: upDocBody.storageKey,
            sizeBytes: upDocBody.sizeBytes,
            mimeType: upDocBody.mimeType,
            type: 'CONTRACT',
            transactionId: txId,
        });
        assert.equal(docRec.status, 201);

        // Other brokerage cannot request view-url
        const crossOrgView = await call('GET', `/api/documents/${docRec.body.id}/view-url`, b);
        assert.equal(crossOrgView.status, 404);

        // Authorized agent gets a signed 10-minute URL that serves the PDF
        const viewUrlRes = await call('GET', `/api/documents/${docRec.body.id}/view-url`, a);
        assert.equal(viewUrlRes.status, 200);
        const signedFetch = await fetch(viewUrlRes.body.url);
        assert.equal(signedFetch.status, 200);
        assert.equal(signedFetch.headers.get('content-type'), 'application/pdf');

        // Deleting the document removes the underlying stored file
        const delDoc = await call('DELETE', `/api/documents/${docRec.body.id}`, a);
        assert.equal(delDoc.status, 200);
        const signedAfterDel = await fetch(viewUrlRes.body.url);
        assert.equal(signedAfterDel.status, 404, 'deleted document cleans up underlying stored file');
    });

    await step('automated lead routing: round-robin rule, simulator, and agent availability', async () => {
        // Create a ROUND_ROBIN rule for Open House inquiries
        const ruleRes = await call('POST', '/api/settings/lead-routing', a, {
            name: 'Open House Round Robin',
            source: 'Open House',
            strategy: 'ROUND_ROBIN',
        });
        assert.equal(ruleRes.status, 201);
        const ruleId = ruleRes.body.id;

        // List rules
        const listRes = await call('GET', '/api/settings/lead-routing', a);
        assert.equal(listRes.status, 200);
        assert.equal(listRes.body.length, 1);

        // Dry-run simulator matches our rule
        const simRes = await call('POST', '/api/settings/lead-routing/test', a, {
            source: 'Open House',
            city: 'New York',
            price: 1000000,
        });
        assert.equal(simRes.status, 200);
        assert.equal(simRes.body.matchedRuleId, ruleId);
        assert.equal(simRes.body.strategyUsed, 'ROUND_ROBIN');

        // Cross-org isolation on routing rule
        const crossDel = await call('DELETE', `/api/settings/lead-routing/${ruleId}`, b);
        assert.equal(crossDel.status, 404);

        // Delete rule
        const delRule = await call('DELETE', `/api/settings/lead-routing/${ruleId}`, a);
        assert.equal(delRule.status, 200);
    });

    await step('email notification preferences persistence', async () => {
        const getPrefs = await call('GET', '/api/settings/notifications', a);
        assert.equal(getPrefs.status, 200);
        assert.equal(getPrefs.body.emailNewClient, true);
        assert.equal(getPrefs.body.emailTaskOverdue, true);

        const patchPrefs = await call('PATCH', '/api/settings/notifications', a, {
            emailNewClient: false,
            emailTaskOverdue: false,
            digestFrequency: 'realtime',
        });
        assert.equal(patchPrefs.status, 200);
        assert.equal(patchPrefs.body.emailNewClient, false);
        assert.equal(patchPrefs.body.emailTaskOverdue, false);
        assert.equal(patchPrefs.body.digestFrequency, 'realtime');

        const verifyPrefs = await call('GET', '/api/settings/notifications', a);
        assert.equal(verifyPrefs.status, 200);
        assert.equal(verifyPrefs.body.emailNewClient, false);
    });

    await step('custom public page slug, redirect history, and brand color', async () => {
        const orgRes = await call('GET', '/api/settings/organization', a);
        assert.equal(orgRes.status, 200);
        const oldSlug = orgRes.body.slug;
        assert.ok(oldSlug, 'organization has initial slug');

        const newSlug = `alpha-custom-${run}`;
        const patchOrg = await call('PATCH', '/api/settings/organization', a, {
            slug: newSlug,
            brandColor: '#C5A059',
        });
        assert.equal(patchOrg.status, 200);
        assert.equal(patchOrg.body.slug, newSlug);
        assert.equal(patchOrg.body.brandColor, '#C5A059');

        // Old slug still resolves via OrgSlugHistory and returns canonicalSlug
        const oldFetch = await call('GET', `/api/properties/public?b=${encodeURIComponent(oldSlug)}`);
        assert.equal(oldFetch.status, 200);
        assert.equal(oldFetch.body.organization.slug, newSlug);
        assert.equal(oldFetch.body.redirectedFrom, oldSlug);
        assert.equal(oldFetch.body.canonicalSlug, newSlug);

        // Another brokerage cannot claim the active or historical slug
        const stealActive = await call('PATCH', '/api/settings/organization', b, { slug: newSlug });
        assert.equal(stealActive.status, 409, 'cannot claim active slug of another brokerage');
        const stealHistory = await call('PATCH', '/api/settings/organization', b, { slug: oldSlug });
        assert.equal(stealHistory.status, 409, 'cannot claim historical slug of another brokerage');
    });

    await step('CSV bulk import for clients and properties (create, skip duplicate, update duplicate)', async () => {
        const cImport1 = await call('POST', '/api/clients/import', a, {
            onDuplicate: 'skip',
            rows: [
                { fullName: 'Jordan Taylor', email: `jordan-${run}@example.com`, phone: '212-555-0191', type: 'BUYER', budget: '$1.8M' },
                { firstName: 'Casey', lastName: 'Morgan', email: `casey-${run}@example.com`, type: 'SELLER' },
            ],
        });
        assert.equal(cImport1.status, 200);
        assert.equal(cImport1.body.created, 2);
        assert.equal(cImport1.body.skipped, 0);

        // Re-importing with onDuplicate='skip' skips both
        const cImportSkip = await call('POST', '/api/clients/import', a, {
            onDuplicate: 'skip',
            rows: [{ fullName: 'Jordan Taylor', email: `jordan-${run}@example.com`, budget: '$2.2M' }],
        });
        assert.equal(cImportSkip.status, 200);
        assert.equal(cImportSkip.body.created, 0);
        assert.equal(cImportSkip.body.skipped, 1);

        // Re-importing with onDuplicate='update' updates existing
        const cImportUpdate = await call('POST', '/api/clients/import', a, {
            onDuplicate: 'update',
            rows: [{ fullName: 'Jordan Taylor', email: `jordan-${run}@example.com`, budget: '$2.2M' }],
        });
        assert.equal(cImportUpdate.status, 200);
        assert.equal(cImportUpdate.body.updated, 1);

        // Property bulk import
        const pImport1 = await call('POST', '/api/properties/import', a, {
            onDuplicate: 'skip',
            rows: [
                { address: '15 Central Park West Apt 18B', city: 'New York', state: 'NY', zip: '10023', price: '$6,500,000', beds: 3, baths: 3.5, sqft: '2,900', mlsNumber: `MLS-${run}-1` },
            ],
        });
        assert.equal(pImport1.status, 200);
        assert.equal(pImport1.body.created, 1);

        const pImportDup = await call('POST', '/api/properties/import', a, {
            onDuplicate: 'skip',
            rows: [
                { address: '15 Central Park West Apt 18B', city: 'New York', state: 'NY', zip: '10023', price: '6700000', mlsNumber: `MLS-${run}-1` },
            ],
        });
        assert.equal(pImportDup.status, 200);
        assert.equal(pImportDup.body.skipped, 1);
    });

    await step('archive client hides it from the list', async () => {
        const r = await call('DELETE', `/api/clients/${clientId}`, a);
        assert.equal(r.status, 200);
        const list = await call('GET', '/api/clients?q=pat', a);
        assert.equal(list.body.total, 0);
    });

    await step('audit trail covers listings, offers, appointments and documents (no secrets in it)', async () => {
        const sec = await register('audit');
        const prop = await call('POST', '/api/properties', sec, { propertyType: 'CASA', address: '1 Audit St', city: 'New York', state: 'NY', zip: '10001', price: 500000, beds: 1, baths: 1 });
        assert.equal(prop.status, 201, JSON.stringify(prop.body));
        const pid = prop.body.id as string;
        assert.equal((await call('PATCH', `/api/properties/${pid}`, sec, { price: 510000 })).status, 200);
        const cl = await call('POST', '/api/clients', sec, { firstName: 'Audit', lastName: `Buyer${run}` });
        assert.equal(cl.status, 201, JSON.stringify(cl.body));
        const off = await call('POST', '/api/offers', sec, { amount: 480000, propertyId: pid, clientId: cl.body.id });
        assert.equal(off.status, 201, JSON.stringify(off.body));
        assert.equal((await call('PATCH', `/api/offers/${off.body.id}`, sec, { status: 'REJECTED' })).status, 200);
        const ap = await call('POST', '/api/appointments', sec, { title: 'Audit showing', type: 'SHOWING', date: new Date(Date.now() + 7200000).toISOString() });
        assert.equal(ap.status, 201, JSON.stringify(ap.body));
        assert.equal((await call('PATCH', `/api/appointments/${ap.body.id}`, sec, { status: 'CONFIRMED' })).status, 200);
        assert.equal((await call('DELETE', `/api/appointments/${ap.body.id}`, sec)).status, 200);
        const doc = await call('POST', '/api/documents', sec, { name: 'Audit doc', url: 'https://example.com/secret-link-token-123', type: 'OTHER' });
        assert.equal(doc.status, 201, JSON.stringify(doc.body));
        assert.equal((await call('PATCH', `/api/documents/${doc.body.id}`, sec, { name: 'Audit doc renamed' })).status, 200);
        assert.equal((await call('DELETE', `/api/documents/${doc.body.id}`, sec)).status, 200);
        assert.equal((await call('DELETE', `/api/properties/${pid}`, sec)).status, 200);

        const log = await call('GET', '/api/settings/organization/audit-log', sec);
        assert.equal(log.status, 200);
        const actions = new Set<string>(log.body.logs.map((l: any) => l.action));
        for (const want of ['CREATE_PROPERTY', 'UPDATE_PROPERTY', 'WITHDRAW_PROPERTY', 'CREATE_OFFER', 'UPDATE_OFFER',
            'CREATE_APPOINTMENT', 'UPDATE_APPOINTMENT', 'DELETE_APPOINTMENT', 'CREATE_DOCUMENT', 'UPDATE_DOCUMENT', 'DELETE_DOCUMENT']) {
            assert.ok(actions.has(want), `audit log is missing ${want}`);
        }
        const upd = log.body.logs.find((l: any) => l.action === 'UPDATE_PROPERTY');
        assert.deepEqual(JSON.parse(upd.before), { price: 500000 });
        assert.deepEqual(JSON.parse(upd.after), { price: 510000 });
        assert.ok(!JSON.stringify(log.body.logs).includes('secret-link-token-123'), 'document links must never be written to the audit trail');
    });

    // Security policy: the settings are saved AND enforced (session length, password rules, sign-out on password change, expiry).
    // Needs DATABASE_URL and JWT_SECRET (to mint an older token and to back-date a password change).
    await step('security policy is saved and enforced', async () => {
        if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
            console.log('    (skipped: set DATABASE_URL and JWT_SECRET to run the security policy checks)');
            return;
        }
        const prisma = createPrismaClient();
        try {
            const owner = await register('secpol');
            const me = await call('GET', '/api/settings/profile', owner);
            const ownerId = me.body.id as string;
            const patch = (token: string, body: unknown) => call('PATCH', '/api/settings/security', token, body);

            // Defaults match the behaviour before the policy existed
            const def = await call('GET', '/api/settings/security', owner);
            assert.equal(def.status, 200);
            assert.deepEqual(def.body, { sessionTimeoutMinutes: 1440, minPasswordLength: 8, requirePasswordSpecialChar: false, passwordExpiryDays: 0, logoutOnPasswordChange: true });

            // Validation and permission
            assert.equal((await patch(owner, { sessionTimeoutMinutes: 7 })).status, 400);
            assert.equal((await patch(owner, { minPasswordLength: 4 })).status, 400);
            assert.equal((await patch(owner, { passwordExpiryDays: 5 })).status, 400);
            assert.equal((await patch(owner, { requirePasswordSpecialChar: 'yes' })).status, 400);
            assert.equal((await patch(owner, {})).status, 400);
            // One invitation can be retried: a rejected password does not consume it (pending invites reserve seats)
            const inviteMember = async (label: string, attempts: Array<[string, number]>) => {
                const email = `${label}-${run}@smoke.test`;
                const inv = await call('POST', '/api/settings/invite', owner, { email, role: 'AGENT' });
                assert.equal(inv.status, 200, JSON.stringify(inv.body));
                const row = await prisma.invitation.findFirst({ where: { email }, orderBy: { createdAt: 'desc' } });
                let token: string | undefined;
                for (const [password, wantStatus] of attempts) {
                    const acc = await call('POST', '/api/auth/accept-invite', undefined, { name: label, email, password, inviteToken: row!.token });
                    assert.equal(acc.status, wantStatus, `${label} with "${password}": ${JSON.stringify(acc.body)}`);
                    if (acc.status === 201) token = acc.body.token as string;
                }
                return token;
            };
            const agentToken = (await inviteMember('secagent', [['SmokeTest123!', 201]]))!;
            assert.equal((await patch(agentToken, { minPasswordLength: 20 })).status, 403, 'agents cannot change the policy');

            // Password rules apply to invitations
            assert.equal((await patch(owner, { minPasswordLength: 12, requirePasswordSpecialChar: true })).status, 200);
            await inviteMember('secnew', [['Ab1!short', 400], ['NoSpecialChars123', 400], ['Long-Enough-Pass1', 201]]);
            assert.equal((await patch(owner, { minPasswordLength: 8, requirePasswordSpecialChar: false })).status, 200);

            // Session length: a token older than the limit is refused with 401 (not 403)
            const now = Math.floor(Date.now() / 1000);
            const oldToken = jwt.sign({ userId: ownerId, iat: now - 20 * 60 }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '24h' });
            assert.equal((await call('GET', '/api/settings/profile', oldToken)).status, 200, 'a 20-minute-old session is fine with the default limit');
            assert.equal((await patch(owner, { sessionTimeoutMinutes: 15 })).status, 200);
            const expired = await call('GET', '/api/settings/profile', oldToken);
            assert.equal(expired.status, 401);
            assert.equal(expired.body.code, 'SESSION_EXPIRED');
            assert.equal((await call('GET', '/api/settings/profile', owner)).status, 200, 'a fresh session still works');
            assert.equal((await patch(owner, { sessionTimeoutMinutes: 1440 })).status, 200);

            // Signing out on password change: sessions started before the change stop working
            await prisma.user.update({ where: { id: ownerId }, data: { passwordChangedAt: new Date() } });
            // The owner's own earlier session is now stale too, so continue with a session that starts after the change
            const fresh = jwt.sign({ userId: ownerId }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '24h' });
            assert.equal((await patch(fresh, { logoutOnPasswordChange: true })).status, 200); // also flushes the account cache
            const changed = await call('GET', '/api/settings/profile', oldToken);
            assert.equal(changed.status, 401);
            assert.equal(changed.body.code, 'PASSWORD_CHANGED');
            assert.equal((await patch(fresh, { logoutOnPasswordChange: false })).status, 200);
            assert.equal((await call('GET', '/api/settings/profile', oldToken)).status, 200, 'with the switch off, old sessions keep working');
            assert.equal((await patch(fresh, { logoutOnPasswordChange: true })).status, 200);

            // Password expiry: enforced at sign-in when the server can send reset emails, otherwise ignored so nobody is locked out
            assert.equal((await patch(fresh, { passwordExpiryDays: 30 })).status, 200);
            await prisma.user.update({ where: { id: ownerId }, data: { passwordChangedAt: new Date(Date.now() - 40 * 86400000) } });
            const login = await call('POST', '/api/auth/login', undefined, { email: `secpol-${run}@smoke.test`, password: 'SmokeTest123!' });
            if (process.env.EMAIL_API_KEY && process.env.EMAIL_FROM) {
                assert.equal(login.status, 403, JSON.stringify(login.body));
                assert.equal(login.body.code, 'PASSWORD_EXPIRED');
            } else {
                assert.equal(login.status, 200, 'without a working reset email the expiry must not lock anyone out');
            }
        } finally {
            await prisma.$disconnect();
        }
    });

    // Permission matrix: 401 vs 403 stay distinct, and each role only reaches what it should.
    // Needs DATABASE_URL (the invitation token is only ever emailed, so we read it from the DB).
    await step('permission matrix: roles, tiers and 401 / 403 behaviour', async () => {
        if (!process.env.DATABASE_URL) {
            console.log('    (skipped: set DATABASE_URL to run the permission matrix)');
            return;
        }
        const prisma = createPrismaClient();
        try {
            const owner = await register('perm');
            const join = async (label: string, role: string) => {
                const email = `${label}-${run}@smoke.test`;
                const inv = await call('POST', '/api/settings/invite', owner, { email, role });
                assert.equal(inv.status, 200, JSON.stringify(inv.body));
                const row = await prisma.invitation.findFirst({ where: { email }, orderBy: { createdAt: 'desc' } });
                assert.ok(row, 'invitation row exists');
                const acc = await call('POST', '/api/auth/accept-invite', undefined, { name: `${label} User`, email, password: 'SmokeTest123!', inviteToken: row!.token });
                assert.equal(acc.status, 201, JSON.stringify(acc.body));
                return { token: acc.body.token as string, id: acc.body.user?.id as string };
            };
            const manager = await join('permmgr', 'MANAGER');
            const agent = await join('permagent', 'AGENT');
            const me = await call('GET', '/api/settings/profile', owner);
            const ownerId = me.body.id as string;
            assert.ok(ownerId && manager.id && agent.id, 'user ids resolved');

            const expectStatus = async (who: string, token: string | undefined, method: string, path: string, want: number, body?: unknown) => {
                const r = await call(method, path, token, body);
                assert.equal(r.status, want, `${who} ${method} ${path}: expected ${want}, got ${r.status} ${JSON.stringify(r.body)?.slice(0, 120)}`);
            };

            // Not signed in, or a bad token: always 401, never 403
            for (const path of ['/api/clients', '/api/settings/users', '/api/finance/payout-requests', '/api/dashboard']) {
                await expectStatus('anonymous', undefined, 'GET', path, 401);
                await expectStatus('bad token', 'not-a-real-token', 'GET', path, 401);
            }

            // Agent: no management or admin endpoints
            await expectStatus('agent', agent.token, 'GET', '/api/settings/users', 403);
            await expectStatus('agent', agent.token, 'POST', '/api/settings/invite', 403, { email: `nope-${run}@smoke.test`, role: 'AGENT' });
            await expectStatus('agent', agent.token, 'PATCH', '/api/settings/organization', 403, { name: 'Hijacked' });
            await expectStatus('agent', agent.token, 'GET', '/api/settings/organization/audit-log', 403);
            await expectStatus('agent', agent.token, 'GET', '/api/settings/organization/export', 403);
            await expectStatus('agent', agent.token, 'PUT', `/api/settings/users/${manager.id}/role`, 403, { role: 'FIRMADMIN' });
            await expectStatus('agent', agent.token, 'DELETE', `/api/settings/users/${manager.id}`, 403);
            await expectStatus('agent', agent.token, 'GET', '/api/settings/lead-routing', 403);
            await expectStatus('agent', agent.token, 'GET', '/api/finance/payout-requests', 403);
            await expectStatus('agent', agent.token, 'POST', '/api/finance/commissions/none/approve', 403);

            // Manager: management endpoints yes, admin-only endpoints no
            await expectStatus('manager', manager.token, 'GET', '/api/settings/users', 200);
            await expectStatus('manager', manager.token, 'GET', '/api/settings/lead-routing', 200);
            await expectStatus('manager', manager.token, 'GET', '/api/finance/payout-requests', 200);
            await expectStatus('manager', manager.token, 'PATCH', '/api/settings/organization', 403, { name: 'Hijacked' });
            await expectStatus('manager', manager.token, 'GET', '/api/settings/organization/audit-log', 403);
            await expectStatus('manager', manager.token, 'GET', '/api/settings/organization/export', 403);
            await expectStatus('manager', manager.token, 'PUT', `/api/settings/users/${agent.id}/role`, 403, { role: 'MANAGER' });
            await expectStatus('manager', manager.token, 'DELETE', `/api/settings/users/${agent.id}`, 403);
            await expectStatus('manager', manager.token, 'POST', '/api/settings/invite', 403, { email: `admin-${run}@smoke.test`, role: 'FIRMADMIN' });

            // Firm admin (the owner): everything above is allowed
            await expectStatus('owner', owner, 'GET', '/api/settings/users', 200);
            await expectStatus('owner', owner, 'GET', '/api/settings/organization/audit-log', 200);
            await expectStatus('owner', owner, 'GET', '/api/settings/organization/export', 200);

            // Subscription tier: a CORE org is refused ELITE features with 403 (not 401) and the required tier
            const tier = await call('GET', '/api/finance/projections', owner);
            assert.equal(tier.status, 403, JSON.stringify(tier.body));
            assert.equal(tier.body.requiredTier, 'ELITE');

            // Row level: an agent cannot see or take over another user's client, a manager can reassign
            const c = await call('POST', '/api/clients', owner, { firstName: 'Perm', lastName: `Client${run}`, email: `permclient-${run}@example.com` });
            assert.equal(c.status, 201, JSON.stringify(c.body));
            const cid = c.body.id as string;
            const peek = await call('GET', `/api/clients/${cid}`, agent.token);
            assert.ok(peek.status === 403 || peek.status === 404, `agent must not read the owner's client, got ${peek.status}`);
            const list = await call('GET', `/api/clients?q=Client${run}`, agent.token);
            assert.equal(list.status, 200);
            assert.equal(list.body.total, 0, "agent list must not include the owner's client");
            await expectStatus('agent', agent.token, 'PATCH', `/api/clients/${cid}`, 404, { notes: 'x' });
            await expectStatus('agent', agent.token, 'POST', '/api/clients', 403, { firstName: 'Steal', lastName: 'Lead', agentId: ownerId });
            await expectStatus('manager', manager.token, 'PATCH', `/api/clients/${cid}`, 200, { agentId: agent.id });
            await expectStatus('agent', agent.token, 'GET', `/api/clients/${cid}`, 200);
        } finally {
            await prisma.$disconnect();
        }
    });

    // ── Settings policies and preferences (Settings > CRM / Properties / Finance / Appointments / Documents) ──
    // These steps create staff accounts, so they need DATABASE_URL (to read invitation tokens).
    const needsDb = (name: string) => {
        if (process.env.DATABASE_URL) return false;
        console.log(`    (skipped ${name}: set DATABASE_URL)`);
        return true;
    };

    await step('settings policies and preferences: defaults, validation, permissions, audit trail', async () => {
        if (needsDb('policies')) return;
        const owner = await register('pol');
        const agent = await joinOrg(owner, 'polagent', 'AGENT');

        const def = await call('GET', '/api/settings/policies', agent.token);
        assert.equal(def.status, 200, JSON.stringify(def.body));
        const d = def.body.policies;
        assert.equal(d.crm.maxClientsPerAgent, 0, 'no client limit by default');
        assert.equal(d.crm.clientVisibility, 'own');
        assert.equal(d.crm.duplicateCheck, true);
        assert.equal(d.properties.photosRequiredToActivate, 0);
        assert.equal(d.finance.fiscalYearStartMonth, 1);
        assert.equal(d.appointments.preventDoubleBooking, false);
        assert.equal(d.documents.maxFileSizeMb, 20);
        assert.ok(d.crm.leadSources.includes('WhatsApp') && d.crm.leadSources.includes('InfoCasas'), 'Uruguay lead sources by default');

        assert.equal((await call('GET', '/api/settings/policies')).status, 401, 'anonymous cannot read policies');
        assert.equal((await call('PATCH', '/api/settings/policies', agent.token, { crm: { maxClientsPerAgent: 5 } })).status, 403, 'agents cannot change policies');

        for (const bad of [
            { crm: { clientVisibility: 'team' } }, { crm: { maxClientsPerAgent: -1 } }, { crm: { requiredFields: ['ssn'] } },
            { crm: { leadSources: [] } }, { crm: { unknownOption: 1 } }, { unknownSection: {} },
            { finance: { fiscalYearStartMonth: 13 } }, { documents: { maxFileSizeMb: 21 } }, { documents: { allowedFormats: [] } },
            { appointments: { workdayStart: '18:00', workdayEnd: '09:00' } }, { appointments: { bufferMinutes: 7 } },
            { properties: { photosRequiredToActivate: 5, maxPhotosPerListing: 3 } },
        ]) {
            const r = await call('PATCH', '/api/settings/policies', owner, bad);
            assert.equal(r.status, 400, `should reject ${JSON.stringify(bad)}: ${JSON.stringify(r.body)}`);
        }
        const unchanged = await call('GET', '/api/settings/policies', owner);
        assert.deepEqual(unchanged.body.policies, d, 'rejected changes leave the policies untouched');

        const ok = await call('PATCH', '/api/settings/policies', owner, { crm: { maxClientsPerAgent: 7, requiredFields: ['phone', 'phone'] }, finance: { fiscalYearStartMonth: 4 } });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.deepEqual(ok.body.policies.crm.requiredFields, ['phone'], 'duplicates are removed');
        const seen = await call('GET', '/api/settings/policies', agent.token);
        assert.equal(seen.body.policies.crm.maxClientsPerAgent, 7, 'members see the new policy right away');
        assert.equal(seen.body.policies.finance.fiscalYearStartMonth, 4);

        // An identical save changes nothing and adds no audit entry
        await call('PATCH', '/api/settings/policies', owner, { crm: { maxClientsPerAgent: 7 } });
        const log = await call('GET', '/api/settings/organization/audit-log', owner);
        const entries = log.body.logs.filter((l: any) => l.action === 'UPDATE_ORG_POLICIES');
        assert.equal(entries.length, 1, 'only the real change is audited');
        assert.equal(JSON.parse(entries[0].after)['crm.maxClientsPerAgent'], 7);
        assert.equal(JSON.parse(entries[0].before)['crm.maxClientsPerAgent'], 0);

        // Personal preferences: own values only, validated
        const p0 = await call('GET', '/api/settings/preferences', agent.token);
        assert.equal(p0.status, 200);
        assert.equal(p0.body.preferences.appointments.reminderLeadHours, 24);
        assert.equal(p0.body.preferences.crm.showBudget, true);
        assert.equal((await call('PATCH', '/api/settings/preferences', agent.token, { appointments: { reminderLeadHours: 3 } })).status, 400);
        assert.equal((await call('PATCH', '/api/settings/preferences', agent.token, { nope: {} })).status, 400);
        const p1 = await call('PATCH', '/api/settings/preferences', agent.token, { appointments: { reminderLeadHours: 2, defaultDurationMin: 45 }, crm: { compactList: true } });
        assert.equal(p1.status, 200, JSON.stringify(p1.body));
        assert.equal((await call('GET', '/api/settings/preferences', agent.token)).body.preferences.appointments.reminderLeadHours, 2);
        assert.equal((await call('GET', '/api/settings/preferences', owner)).body.preferences.appointments.reminderLeadHours, 24, "one person's preferences never change another's");
        assert.equal((await call('GET', '/api/settings/preferences')).status, 401);
    });

    await step('CRM policy is enforced: required fields, client limit, duplicate check, visibility, import', async () => {
        if (needsDb('CRM policy')) return;
        const owner = await register('crmpol');
        const agent = await joinOrg(owner, 'crmagent', 'AGENT');
        const setPolicy = async (body: unknown) => {
            const r = await call('PATCH', '/api/settings/policies', owner, body);
            assert.equal(r.status, 200, JSON.stringify(r.body));
        };
        let n = 0;
        const person = (extra: Record<string, unknown> = {}) => ({ firstName: 'Pol', lastName: `C${run}`, phone: `555-01${String(++n).padStart(2, '0')}`, email: `pol-${run}-${n}@example.com`, ...extra });

        // Required fields
        await setPolicy({ crm: { requiredFields: ['phone', 'email'], duplicateCheck: false } });
        const noPhone = await call('POST', '/api/clients', owner, { firstName: 'No', lastName: 'Phone', email: `np-${run}@example.com` });
        assert.equal(noPhone.status, 400); assert.equal(noPhone.body.code, 'REQUIRED_FIELD'); assert.match(noPhone.body.error, /Phone/);
        const noEmail = await call('POST', '/api/clients', owner, { firstName: 'No', lastName: 'Email', phone: '555-0000' });
        assert.equal(noEmail.status, 400); assert.match(noEmail.body.error, /Email/);

        // Duplicate check off: the same email / phone can be saved twice
        const a = await call('POST', '/api/clients', owner, person());
        assert.equal(a.status, 201, JSON.stringify(a.body));
        const b = await call('POST', '/api/clients', owner, { ...person(), phone: a.body.phone, email: a.body.email });
        assert.equal(b.status, 201, 'duplicate check is off');
        await setPolicy({ crm: { duplicateCheck: true } });
        assert.equal((await call('POST', '/api/clients', owner, { ...person(), email: a.body.email })).status, 409, 'duplicate check is on again');

        // Required fields also apply when editing
        const clear = await call('PATCH', `/api/clients/${b.body.id}`, owner, { phone: '' });
        assert.equal(clear.status, 400); assert.equal(clear.body.code, 'REQUIRED_FIELD');
        assert.equal((await call('PATCH', `/api/clients/${b.body.id}`, owner, { notes: 'edited' })).status, 200, 'editing other fields is fine');

        // Client limit per agent: counts open clients only
        await setPolicy({ crm: { maxClientsPerAgent: 2 } });
        const over = await call('POST', '/api/clients', owner, person());
        assert.equal(over.status, 409); assert.equal(over.body.code, 'CLIENT_LIMIT');
        assert.equal((await call('DELETE', `/api/clients/${a.body.id}`, owner)).status, 200, 'archiving frees a place');
        const d = await call('POST', '/api/clients', owner, person());
        assert.equal(d.status, 201, JSON.stringify(d.body));
        const reopen = await call('PATCH', `/api/clients/${a.body.id}`, owner, { status: 'LEAD' });
        assert.equal(reopen.status, 409, 'reopening counts toward the limit'); assert.equal(reopen.body.code, 'CLIENT_LIMIT');
        assert.equal((await call('PATCH', `/api/clients/${d.body.id}`, owner, { agentId: agent.id })).status, 200, "reassigning to an agent under the limit works");

        // CSV import honours both rules (the owner now has 1 open client, so 1 place is left)
        const imp = await call('POST', '/api/clients/import', owner, { rows: [
            { firstName: 'Imp', lastName: 'One', email: `imp1-${run}@example.com` },                       // no phone
            { firstName: 'Imp', lastName: 'Two', email: `imp2-${run}@example.com`, phone: '555-7002' },     // ok
            { firstName: 'Imp', lastName: 'Three', email: `imp3-${run}@example.com`, phone: '555-7003' },   // over the limit
        ] });
        assert.equal(imp.status, 200, JSON.stringify(imp.body));
        assert.equal(imp.body.created, 1);
        assert.equal(imp.body.errors.length, 2);
        assert.match(imp.body.errors[0].reason, /Phone/);
        assert.match(imp.body.errors[1].reason, /limit/i);

        // Visibility: 'all' lets the agent READ the whole book, but never edit other agents' clients
        await setPolicy({ crm: { maxClientsPerAgent: 0 } });
        assert.equal((await call('GET', `/api/clients/${b.body.id}`, agent.token)).status, 404, "default: an agent cannot see another agent's client");
        await setPolicy({ crm: { clientVisibility: 'all' } });
        assert.equal((await call('GET', `/api/clients/${b.body.id}`, agent.token)).status, 200, "'all': the agent can read it");
        const listed = await call('GET', `/api/clients?q=C${run}&limit=50`, agent.token);
        assert.ok(listed.body.total >= 2, 'and it shows in their list');
        assert.equal((await call('PATCH', `/api/clients/${b.body.id}`, agent.token, { notes: 'hijack' })).status, 403, 'but cannot edit it');
        assert.equal((await call('POST', `/api/clients/${b.body.id}/activities`, agent.token, { type: 'NOTE', content: 'hi' })).status, 403, 'or log activity on it');
        assert.equal((await call('PATCH', `/api/clients/${d.body.id}`, agent.token, { notes: 'mine' })).status, 200, 'their own client stays editable');
        await setPolicy({ crm: { clientVisibility: 'own' } });
        assert.equal((await call('GET', `/api/clients/${b.body.id}`, agent.token)).status, 404, 'back to own clients only');
    });

    await step('Properties policy is enforced: who creates, required fields, description length, photos before Active, photo limit', async () => {
        if (needsDb('Properties policy')) return;
        const owner = await register('proppol');
        const agent = await joinOrg(owner, 'propagent', 'AGENT');
        const setPolicy = async (body: unknown) => assert.equal((await call('PATCH', '/api/settings/policies', owner, body)).status, 200);
        const base = { propertyType: 'CASA', address: '7 Policy St', city: 'New York', state: 'NY', zip: '10007', price: 900000, beds: 2, baths: 1 };

        // Who can create
        await setPolicy({ properties: { whoCanCreate: 'MANAGERS' } });
        const denied = await call('POST', '/api/properties', agent.token, base);
        assert.equal(denied.status, 403); assert.match(denied.body.error, /managers/i);
        assert.equal((await call('POST', '/api/properties', owner, base)).status, 201, 'managers still can');
        await setPolicy({ properties: { whoCanCreate: 'ALL_STAFF' } });
        assert.equal((await call('POST', '/api/properties', agent.token, { ...base, address: '8 Policy St' })).status, 201);

        // Required fields, description length, photos before Active
        await setPolicy({ properties: { requiredFields: ['sqft', 'description'], descriptionMaxChars: 100, photosRequiredToActivate: 2, maxPhotosPerListing: 3 } });
        const noSqft = await call('POST', '/api/properties', owner, { ...base, address: '9 Policy St' });
        assert.equal(noSqft.status, 400); assert.equal(noSqft.body.code, 'LISTING_POLICY'); assert.match(noSqft.body.error, /Square footage/);
        const wordy = await call('POST', '/api/properties', owner, { ...base, address: '9 Policy St', sqft: 900, description: 'x'.repeat(101) });
        assert.equal(wordy.status, 400); assert.match(wordy.body.error, /at most 100/);
        const early = await call('POST', '/api/properties', owner, { ...base, address: '9 Policy St', sqft: 900, description: 'Bright', status: 'ACTIVE' });
        assert.equal(early.status, 400); assert.equal(early.body.code, 'PHOTOS_REQUIRED');
        const made = await call('POST', '/api/properties', owner, { ...base, address: '9 Policy St', sqft: 900, description: 'Bright' });
        assert.equal(made.status, 201, JSON.stringify(made.body));
        assert.equal(made.body.status, 'COMING_SOON', 'without photos a new listing starts as Coming Soon');
        const pid = made.body.id as string;

        const photo = (n: number, type = 'image') => call('POST', '/api/media', owner, { url: `https://example.com/p${n}.jpg`, type, propertyId: pid });
        assert.equal((await photo(1)).status, 201);
        const tooSoon = await call('PATCH', `/api/properties/${pid}`, owner, { status: 'ACTIVE' });
        assert.equal(tooSoon.status, 400); assert.equal(tooSoon.body.code, 'PHOTOS_REQUIRED'); assert.match(tooSoon.body.error, /has 1/);
        assert.equal((await photo(2)).status, 201);
        assert.equal((await call('PATCH', `/api/properties/${pid}`, owner, { status: 'ACTIVE' })).status, 200, 'two photos: it can go Active');
        assert.equal((await photo(3)).status, 201);
        const fourth = await photo(4);
        assert.equal(fourth.status, 400); assert.equal(fourth.body.code, 'PHOTO_LIMIT');
        assert.equal((await photo(5, 'floorplan')).status, 201, 'floor plans are not photos');
        const blank = await call('PATCH', `/api/properties/${pid}`, owner, { description: '' });
        assert.equal(blank.status, 400); assert.equal(blank.body.code, 'LISTING_POLICY');
        assert.equal((await call('PATCH', `/api/properties/${pid}`, owner, { price: 910000 })).status, 200, 'other edits are unaffected');

        // Import: rows marked Active start as Coming Soon (with a warning); missing required fields are reported
        const imp = await call('POST', '/api/properties/import', owner, { rows: [
            { address: '20 Import Ave', city: 'Salto', propertyType: 'CASA', price: 500000, sqft: 700, description: 'Sunny', status: 'Active' },
            { address: '21 Import Ave', city: 'Salto', propertyType: 'CASA', price: 500000, description: 'No size' },
        ] });
        assert.equal(imp.status, 200, JSON.stringify(imp.body));
        assert.equal(imp.body.created, 1);
        assert.equal(imp.body.errors.length, 1); assert.match(imp.body.errors[0].reason, /Square footage/);
        assert.equal(imp.body.warnings.length, 1);
        const imported = await call('GET', '/api/properties?search=20%20Import', owner);
        assert.equal(imported.body.data[0].status, 'COMING_SOON');
    });

    await step('Appointments policy and preferences: double booking, buffer, auto-confirm, default length', async () => {
        if (needsDb('Appointments policy')) return;
        const owner = await register('apptpol');
        const agent = await joinOrg(owner, 'apptagent', 'AGENT');
        const MIN = 60 * 1000;
        const t0 = new Date(Math.floor((Date.now() + 3 * 24 * 60 * MIN) / MIN) * MIN);
        const at = (offsetMin: number) => new Date(t0.getTime() + offsetMin * MIN).toISOString();
        const book = (token: string, offsetMin: number, extra: Record<string, unknown> = {}) =>
            call('POST', '/api/appointments', token, { title: `Appt ${offsetMin}`, type: 'SHOWING', date: at(offsetMin), ...extra });

        assert.equal((await call('PATCH', '/api/settings/preferences', owner, { appointments: { defaultDurationMin: 30, autoConfirm: true } })).status, 200);
        const first = await book(owner, 0);
        assert.equal(first.status, 201, JSON.stringify(first.body));
        assert.equal(first.body.status, 'CONFIRMED', 'auto-confirm preference');
        assert.equal(first.body.durationMin, 30, 'default length preference');
        assert.equal((await book(owner, 2000, { durationMin: 90 })).body.durationMin, 90, 'an explicit length wins');

        // Policy off: overlapping is allowed
        const overlapOff = await book(owner, 10);
        assert.equal(overlapOff.status, 201);
        assert.equal((await call('DELETE', `/api/appointments/${overlapOff.body.id}`, owner)).status, 200);

        assert.equal((await call('PATCH', '/api/settings/policies', owner, { appointments: { preventDoubleBooking: true, bufferMinutes: 15 } })).status, 200);
        const clash = await book(owner, 20);
        assert.equal(clash.status, 409, JSON.stringify(clash.body)); assert.equal(clash.body.code, 'APPOINTMENT_CONFLICT');
        assert.equal(clash.body.conflict.id, first.body.id);
        assert.equal((await book(owner, 40)).status, 409, 'closer than the 15-minute buffer');
        const fits = await book(owner, 45);
        assert.equal(fits.status, 201, `exactly the buffer apart is fine: ${JSON.stringify(fits.body)}`);
        const forced = await book(owner, 10, { force: true });
        assert.equal(forced.status, 201, 'force: true books it anyway');

        // Another agent has their own calendar
        assert.equal((await book(agent.token, 0)).status, 201, 'a different agent is not in conflict');

        // Cancelled appointments no longer block the slot
        const day2 = await book(owner, 1440);
        assert.equal(day2.status, 201);
        assert.equal((await call('PATCH', `/api/appointments/${day2.body.id}`, owner, { status: 'CANCELLED' })).status, 200);
        assert.equal((await book(owner, 1440)).status, 201, 'the cancelled slot is free again');

        // Rescheduling is checked too
        const move = await call('PATCH', `/api/appointments/${fits.body.id}`, owner, { date: at(15) });
        assert.equal(move.status, 409, JSON.stringify(move.body));
        assert.equal((await call('PATCH', `/api/appointments/${fits.body.id}`, owner, { date: at(15), force: true })).status, 200);
        assert.equal((await call('PATCH', `/api/appointments/${fits.body.id}`, owner, { notes: 'just a note' })).status, 200, 'edits that do not move it are not re-checked');
    });

    await step('Documents policy is enforced: allowed formats and file size limit', async () => {
        if (needsDb('Documents policy')) return;
        const owner = await register('docpol');
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
        const smallPdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
        const bigPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2 * 1024 * 1024, 0x20), Buffer.from('\n%%EOF')]);

        assert.equal((await uploadFile(owner, png, 'image/png', 'scan.png', 'PRIVATE')).status, 201, 'default: images are fine');
        assert.equal((await call('PATCH', '/api/settings/policies', owner, { documents: { allowedFormats: ['pdf'], maxFileSizeMb: 1 } })).status, 200);
        const wrong = await uploadFile(owner, png, 'image/png', 'scan.png', 'PRIVATE');
        assert.equal(wrong.status, 400); assert.equal(wrong.body.code, 'FORMAT_NOT_ALLOWED'); assert.match(wrong.body.error, /PDF/);
        const big = await uploadFile(owner, bigPdf, 'application/pdf', 'big.pdf', 'PRIVATE');
        assert.equal(big.status, 413); assert.equal(big.body.code, 'FILE_TOO_LARGE'); assert.match(big.body.error, /1 MB/);
        assert.equal((await uploadFile(owner, smallPdf, 'application/pdf', 'ok.pdf', 'PRIVATE')).status, 201, 'a small PDF passes');
        assert.equal((await uploadFile(owner, png, 'image/png', 'photo.png', 'PUBLIC')).status, 201, 'listing photos are not affected by the document policy');
        assert.equal((await call('PATCH', '/api/settings/policies', owner, { documents: { allowedFormats: ['pdf', 'image'] } })).status, 200);
        assert.equal((await uploadFile(owner, png, 'image/png', 'scan2.png', 'PRIVATE')).status, 201, 'allowing images again works');
    });

    await step('Finance policy: leaderboard privacy and fiscal year start', async () => {
        if (needsDb('Finance policy')) return;
        const owner = await register('finpol');
        const agent = await joinOrg(owner, 'finagent', 'AGENT');
        const closedDeal = async (token: string, label: string, price: number) => {
            const p = await call('POST', '/api/properties', token, { propertyType: 'CASA', address: `${label} Fin St`, city: 'New York', state: 'NY', zip: '10001', price, beds: 1, baths: 1 });
            assert.equal(p.status, 201, JSON.stringify(p.body));
            const c = await call('POST', '/api/clients', token, { firstName: 'Fin', lastName: label });
            assert.equal(c.status, 201, JSON.stringify(c.body));
            const t = await call('POST', '/api/transactions', token, { propertyId: p.body.id, clientId: c.body.id, price, status: 'CLOSED' });
            assert.equal(t.status, 201, JSON.stringify(t.body));
            return t.body.id as string;
        };
        const payAt = async (transactionId: string, paidAt: Date) => {
            const r = await db().commission.updateMany({ where: { transactionId }, data: { status: 'PAID', paidAt } });
            assert.equal(r.count, 1, 'the closed deal created one commission');
        };
        const now = new Date();
        await payAt(await closedDeal(owner, 'Own', 200000), now);          // gross 6,000
        await payAt(await closedDeal(agent.token, 'Ag1', 100000), now);    // gross 3,000
        const oldDeal = await closedDeal(agent.token, 'Ag2', 300000);      // gross 9,000, paid 40 days ago
        const old = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
        await payAt(oldDeal, old);

        // Leaderboard privacy
        const open = await call('GET', '/api/finance/metrics', agent.token);
        assert.equal(open.status, 200, JSON.stringify(open.body));
        assert.equal(open.body.grossHidden, false);
        assert.ok(open.body.leaderboard.every((r: any) => typeof r.gross === 'number'), 'default: everyone sees production');
        assert.equal((await call('PATCH', '/api/settings/policies', owner, { finance: { showAgentGross: false } })).status, 200);
        const hidden = await call('GET', '/api/finance/metrics', agent.token);
        assert.equal(hidden.body.grossHidden, true);
        const rows = hidden.body.leaderboard as { userId: string; gross: number | null; rank: number }[];
        assert.equal(rows.length, 2, 'ranks stay visible');
        assert.equal(rows.find(r => r.userId === agent.id)!.gross !== null, true, 'own production is always visible');
        assert.equal(rows.find(r => r.userId !== agent.id)!.gross, null, "other agents' production is hidden");
        const mgr = await call('GET', '/api/finance/metrics', owner);
        assert.equal(mgr.body.grossHidden, false, 'management still sees everything');
        assert.ok(mgr.body.leaderboard.every((r: any) => typeof r.gross === 'number'));

        // Fiscal year: starting this month leaves out the commission paid 40 days ago
        const janFirst = new Date(now.getFullYear(), 0, 1);
        const calendarYearExpected = 3000 + (old >= janFirst ? 9000 : 0);
        assert.equal(open.body.ytdGross, calendarYearExpected, 'default fiscal year = calendar year');
        assert.equal((await call('PATCH', '/api/settings/policies', owner, { finance: { fiscalYearStartMonth: now.getMonth() + 1 } })).status, 200);
        const fy = await call('GET', '/api/finance/metrics', agent.token);
        assert.equal(fy.body.ytdGross, 3000, 'only commissions paid since the fiscal year start are counted');
    });

    await step('Uruguay listings: prices per operation, "Consultar", hectares, new fields, backfill, privacy, isolation', async () => {
        const owner = await register('uyprop');
        const other = await register('uyprop2');

        // Required fields (spec 6.1)
        assert.equal((await call('POST', '/api/properties', owner, { address: 'Sin tipo 1', city: 'Salto', price: 1 })).status, 400, 'type is required');
        assert.equal((await call('POST', '/api/properties', owner, { propertyType: 'CASTILLO', address: 'X 1', city: 'Salto', price: 1 })).status, 400);
        const noOp = await call('POST', '/api/properties', owner, { propertyType: 'CASA', address: 'Sin precio 1', city: 'Salto' });
        assert.equal(noOp.status, 400);
        assert.equal(noOp.body.code, 'PRICE_REQUIRED');
        assert.equal((await call('POST', '/api/properties', owner, { propertyType: 'CASA', city: 'Salto', price: 1 })).status, 400, 'address or locality');

        // A farm in hectares, price on request, no address (only the locality), no state / zip / beds / baths
        const campo = await call('POST', '/api/properties', owner, {
            propertyType: 'CAMPO_CHACRA', locality: 'colonia  lavalleja', city: 'Salto', landArea: '120,5', landAreaUnit: 'HA',
            prices: [{ operation: 'SALE', onRequest: true }],
        });
        assert.equal(campo.status, 201, JSON.stringify(campo.body));
        assert.equal(campo.body.locality, 'Colonia Lavalleja');
        assert.equal(campo.body.landArea, 120.5);
        assert.equal(campo.body.landAreaUnit, 'HA');
        assert.equal(campo.body.price, null, 'legacy price empty for "Consultar"');
        assert.equal(campo.body.state, null);
        assert.equal(campo.body.prices.length, 1);
        assert.equal(campo.body.prices[0].onRequest, true);
        assert.equal(campo.body.prices[0].amount, null);

        // For sale in US$ and for rent in $ at the same time; amounts typed the Uruguayan way
        const casa = await call('POST', '/api/properties', owner, {
            propertyType: 'CASA', address: 'Uruguay 1234', city: 'Salto', state: 'Salto', beds: 4, baths: 2, builtAreaM2: 180,
            code: '63361', amenities: ['parrillero', 'patio'], garageSpaces: 1, hoaFee: 3500, hoaFeeCurrency: 'UYU', lat: -31.3833, lng: -57.9667,
            prices: [{ operation: 'SALE', amount: '290.000', currency: 'USD' }, { operation: 'RENT', amount: 25000, currency: 'UYU' }],
        });
        assert.equal(casa.status, 201, JSON.stringify(casa.body));
        const byOp = Object.fromEntries(casa.body.prices.map((p: any) => [p.operation, p]));
        assert.equal(Number(byOp.SALE.amount), 290000);
        assert.equal(byOp.SALE.currency, 'USD');
        assert.equal(Number(byOp.RENT.amount), 25000);
        assert.equal(byOp.RENT.currency, 'UYU');
        assert.equal(byOp.RENT.period, 'MONTH', 'rent defaults to monthly');
        assert.equal(casa.body.price, 290000, 'legacy price = sale price');
        assert.equal(casa.body.garageSpaces, 1);
        assert.equal(casa.body.parkingSpaces, 1, 'parkingSpaces kept in step');
        assert.deepEqual(casa.body.amenities, ['parrillero', 'patio']);
        assert.equal((await call('POST', '/api/properties', owner, { propertyType: 'CASA', address: 'Otra 1', city: 'Salto', price: 1, amenities: ['helipuerto'] })).status, 400);
        assert.equal((await call('POST', '/api/properties', owner, { propertyType: 'CASA', address: 'Otra 2', city: 'Salto', price: 1, code: '63361' })).status, 409, 'code is unique per brokerage');
        assert.equal((await call('POST', '/api/properties', other, { propertyType: 'CASA', address: 'Otra 3', city: 'Salto', price: 1, code: '63361' })).status, 201, '…but another brokerage can use it');
        assert.equal((await call('POST', '/api/properties', owner, { propertyType: 'CASA', address: 'Dup 1', city: 'Salto', prices: [{ operation: 'SALE', amount: 1 }, { operation: 'SALE', amount: 2 }] })).status, 400);

        // Dropping an operation deactivates it (nothing is deleted); a legacy `price` only touches the sale
        const onlySale = await call('PATCH', `/api/properties/${casa.body.id}`, owner, { prices: [{ operation: 'SALE', amount: 280000, currency: 'USD' }] });
        assert.equal(onlySale.status, 200, JSON.stringify(onlySale.body));
        const rent = onlySale.body.prices.find((p: any) => p.operation === 'RENT');
        assert.equal(rent.isActive, false);
        assert.equal(onlySale.body.price, 280000);
        const legacy = await call('PATCH', `/api/properties/${casa.body.id}`, owner, { price: 275000 });
        assert.equal(legacy.body.price, 275000);
        assert.equal(Number(legacy.body.prices.find((p: any) => p.operation === 'SALE').amount), 275000);
        assert.equal(legacy.body.prices.find((p: any) => p.operation === 'RENT').isActive, false, 'the inactive rent stays as it was');
        assert.equal((await call('PATCH', `/api/properties/${casa.body.id}`, owner, { prices: [] })).status, 400, 'at least one operation');

        // Isolation: the other brokerage cannot see or edit it, by id or through the list
        assert.equal((await call('GET', `/api/properties/${casa.body.id}`, other)).status, 404);
        assert.equal((await call('PATCH', `/api/properties/${casa.body.id}`, other, { prices: [{ operation: 'SALE', amount: 1 }] })).status, 404);
        const otherList = await call('GET', '/api/properties?limit=100', other);
        assert.ok(!otherList.body.data.some((p: any) => p.id === casa.body.id));

        // Public site: hidden listings and coordinates (spec 8.3)
        const pub = await call('GET', `/api/properties/public/${casa.body.id}`);
        assert.equal(pub.status, 200);
        assert.equal(pub.body.lat, -31.3833, 'EXACT shows the pin');
        assert.ok(pub.body.prices.every((p: any) => p.operation === 'SALE'), 'only active prices are public');
        await call('PATCH', `/api/properties/${casa.body.id}`, owner, { geoPrecision: 'APPROX' });
        const approx = await call('GET', `/api/properties/public/${casa.body.id}`);
        const moved = Math.hypot(approx.body.lat - (-31.3833), approx.body.lng - (-57.9667));
        assert.ok(moved > 0.0005 && moved < 0.005, `APPROX moves the point by 150–300 m (moved ${moved})`);
        const again = await call('GET', `/api/properties/public/${casa.body.id}`);
        assert.equal(again.body.lat, approx.body.lat, 'the same displacement every time');
        await call('PATCH', `/api/properties/${casa.body.id}`, owner, { geoPrecision: 'HIDDEN' });
        assert.equal((await call('GET', `/api/properties/public/${casa.body.id}`)).body.lat, null);
        await call('PATCH', `/api/properties/${casa.body.id}`, owner, { isPublic: false });
        assert.equal((await call('GET', `/api/properties/public/${casa.body.id}`)).status, 404, 'not public');

        // Policy: bedrooms only required for housing
        assert.equal((await call('PATCH', '/api/settings/policies', owner, { properties: { requiredFields: ['beds'] } })).status, 200);
        assert.equal((await call('POST', '/api/properties', owner, { propertyType: 'APARTAMENTO', address: 'Sin dorm 1', city: 'Salto', price: 1 })).status, 400);
        assert.equal((await call('POST', '/api/properties', owner, { propertyType: 'LOCAL_COMERCIAL', address: 'Local 1', city: 'Salto', price: 1 })).status, 201);
        assert.equal((await call('PATCH', '/api/settings/policies', owner, { properties: { requiredFields: [] } })).status, 200);

        // CSV import: no New York defaults, "Consultar", currency from the text
        const imp = await call('POST', '/api/properties/import', owner, {
            rows: [
                { address: 'Artigas 500', city: 'salto', price: 'Consultar', propertyType: 'casa' },
                { address: 'Sin ciudad 1', price: '1000' },
                { address: 'Rivera 10', city: 'Salto', price: '$ 18.000', operation: 'alquiler', propertyType: 'APARTAMENTO' },
            ],
        });
        assert.equal(imp.status, 200, JSON.stringify(imp.body));
        assert.equal(imp.body.created, 2);
        assert.ok(imp.body.errors.some((e: any) => e.row === 2 && /City/.test(e.reason)));
        const imported = (await call('GET', '/api/properties?limit=100&search=Artigas%20500', owner)).body.data[0];
        assert.equal(imported.state, null, 'no NY default');
        assert.equal(imported.zip, null, 'no 10001 default');
        assert.equal(imported.prices[0].onRequest, true);
        const rented = (await call('GET', '/api/properties?limit=100&search=Rivera%2010', owner)).body.data[0];
        assert.equal(rented.prices[0].operation, 'RENT');
        assert.equal(rented.prices[0].currency, 'UYU');
        assert.equal(Number(rented.prices[0].amount), 18000);

        // Photos: WebP copies at 400 / 1024 / 1920 px (never enlarged), original kept, all removed with the photo
        const sharp = (await import('sharp')).default;
        const jpeg = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 180, g: 150, b: 120 } } }).jpeg().toBuffer();
        const up = await uploadFile(owner, jpeg, 'image/jpeg', 'fachada.jpg', 'PUBLIC');
        assert.equal(up.status, 201, JSON.stringify(up.body));
        const media = await call('POST', '/api/media', owner, { url: up.body.url, storageKey: up.body.storageKey, mimeType: 'image/jpeg', type: 'image', propertyId: campo.body.id });
        assert.equal(media.status, 201, JSON.stringify(media.body));
        assert.equal(media.body.width, 2400);
        assert.equal(media.body.height, 1600);
        assert.deepEqual(Object.keys(media.body.variants).sort(), ['lg', 'md', 'thumb']);
        assert.equal(media.body.variants.thumb.width, 400);
        assert.equal(media.body.variants.md.width, 1024);
        assert.equal(media.body.variants.lg.width, 1920);
        assert.equal(media.body.variants.lg.height, 1280);
        const lg = await fetch(media.body.variants.lg.url);
        assert.equal(lg.status, 200);
        assert.equal(lg.headers.get('content-type'), 'image/webp');
        assert.ok(media.body.variants.thumb.sizeBytes < jpeg.byteLength, 'the thumbnail is smaller than the original');
        assert.equal((await fetch(up.body.url)).status, 200, 'original kept');
        const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
        const upSmall = await uploadFile(owner, small, 'image/png', 'chica.png', 'PUBLIC');
        const mediaSmall = await call('POST', '/api/media', owner, { url: upSmall.body.url, storageKey: upSmall.body.storageKey, type: 'image', propertyId: campo.body.id });
        assert.equal(mediaSmall.body.variants.lg.width, 300, 'small photos are not enlarged');
        // Another brokerage cannot attach this brokerage's upload to get variants of it
        const otherProp = await call('POST', '/api/properties', other, { propertyType: 'CASA', address: 'Ajena 1', city: 'Salto', price: 1 });
        const stolen = await call('POST', '/api/media', other, { url: up.body.url, storageKey: up.body.storageKey, type: 'image', propertyId: otherProp.body.id });
        assert.ok(stolen.status !== 201 || !stolen.body.variants, 'no variants from another brokerage\'s file');
        assert.equal((await call('DELETE', `/api/media/${media.body.id}`, owner)).status, 200);
        for (const v of Object.values(media.body.variants) as any[]) assert.equal((await fetch(v.url)).status, 404, 'variants removed with the photo');

        // Backfill: a property with only the legacy price gets a SALE price in USD, once
        const ownerOrg = (await call('GET', '/api/settings/organization', owner)).body;
        const ownerUser = (await call('GET', '/api/settings/profile', owner)).body;
        const legacyRow = await db().property.create({
            data: { address: 'Legacy 1', city: 'Salto', price: 123456, propertyType: 'CASA', agentId: ownerUser.id, orgId: ownerOrg.id },
        });
        const { backfillPrices } = await import('../src/lib/backfillPrices');
        assert.ok(await backfillPrices(db()) >= 1);
        const back = (await call('GET', `/api/properties/${legacyRow.id}`, owner)).body;
        assert.equal(back.prices.length, 1);
        assert.equal(back.prices[0].operation, 'SALE');
        assert.equal(back.prices[0].currency, 'USD');
        assert.equal(Number(back.prices[0].amount), 123456);
        await backfillPrices(db());
        assert.equal((await db().propertyPrice.count({ where: { propertyId: legacyRow.id } })), 1, 'idempotent');
    });

    await step('Uruguay localization: brokerage defaults, catalogs, phones in E.164, city names', async () => {
        const owner = await register('uyloc');
        const org = await call('GET', '/api/settings/organization', owner);
        assert.equal(org.status, 200);
        assert.equal(org.body.country, 'UY');
        assert.equal(org.body.timezone, 'America/Montevideo');
        assert.equal(org.body.defaultCurrency, 'USD');
        assert.equal(org.body.preferredLanguage, 'es');
        const prof = await call('GET', '/api/settings/profile', owner);
        assert.equal(prof.body.timezone, 'America/Montevideo');
        assert.equal((await call('PATCH', '/api/settings/organization', owner, { timezone: 'Mars/Olympus' })).status, 400);
        assert.equal((await call('PATCH', '/api/settings/organization', owner, { defaultCurrency: 'EUR' })).status, 400);
        const loc = await call('PATCH', '/api/settings/organization', owner, { defaultCurrency: 'UYU', phone: '4733 1234' });
        assert.equal(loc.status, 200, JSON.stringify(loc.body));
        assert.equal(loc.body.defaultCurrency, 'UYU');
        assert.equal(loc.body.phone, '+59847331234', 'landline in E.164');

        // Catalogs: fixed lists + editable defaults in the policies
        const cat = await call('GET', '/api/settings/catalogs', owner);
        assert.equal(cat.body.departments.length, 19);
        assert.deepEqual(cat.body.currencies, ['USD', 'UYU', 'UI', 'UR']);
        const pol = (await call('GET', '/api/settings/policies', owner)).body.policies;
        assert.ok(pol.properties.propertyTypes.includes('CAMPO_CHACRA') && !pol.properties.propertyTypes.includes('COOP'));
        assert.ok(pol.properties.amenities.includes('parrillero'));
        assert.equal(pol.properties.usStyleDeal, false);
        assert.equal((await call('PATCH', '/api/settings/policies', owner, { properties: { propertyTypes: ['CASA', 'COOP'] } })).status, 200, 'New York types stay valid');
        assert.equal((await call('PATCH', '/api/settings/policies', owner, { properties: { propertyTypes: ['CASTILLO'] } })).status, 400);
        assert.equal((await call('PATCH', '/api/settings/policies', owner, { properties: { propertyTypes: [] } })).status, 400);

        // Phones: Uruguayan numbers are stored in E.164; anything else as typed
        const c1 = await call('POST', '/api/clients', owner, { firstName: 'Ana', phone: '099 991 525' });
        assert.equal(c1.status, 201, JSON.stringify(c1.body));
        assert.equal(c1.body.phone, '+59899991525');
        const dup = await call('POST', '/api/clients', owner, { firstName: 'Ana', phone: '+598 99 991 525' });
        assert.equal(dup.status, 409, 'the same number written differently is a duplicate');
        const c2 = await call('POST', '/api/clients', owner, { firstName: 'Bob', phone: '+1 212 555 0100' });
        assert.equal(c2.body.phone, '+1 212 555 0100', 'foreign numbers are kept as typed');

        // City names: trimmed, capitalized and matched to the existing spelling regardless of accents
        const p1 = await call('POST', '/api/properties', owner, { propertyType: 'CASA', address: 'Calle 1', city: '  termas  DEL daymán ', state: 'Salto', zip: '50000', price: 1, beds: 1, baths: 1 });
        assert.equal(p1.status, 201, JSON.stringify(p1.body));
        assert.equal(p1.body.city, 'Termas del Daymán');
        const p2 = await call('POST', '/api/properties', owner, { propertyType: 'CASA', address: 'Calle 2', city: 'Termas del Dayman', state: 'Salto', zip: '50000', price: 1, beds: 1, baths: 1 });
        assert.equal(p2.body.city, 'Termas del Daymán', 'same place, existing spelling reused');
        const upd = await call('PATCH', `/api/properties/${p2.body.id}`, owner, { city: 'SALTO' });
        assert.equal(upd.body.city, 'Salto');
    });

    await step('domains: own domain from Settings, Caddy domain-check (on-demand TLS), platform subdomains', async () => {
        const owner = await register('dom1');
        const other = await register('dom2');
        const domain = `castro-${run}.example.uy`;
        const check = async (d: string) => (await call('GET', `/api/public/domain-check?domain=${encodeURIComponent(d)}`)).status;

        assert.equal(await check(domain), 404, 'unknown domain: no certificate');
        assert.equal((await call('PATCH', '/api/settings/organization', owner, { customDomain: 'not a domain' })).status, 400);
        const set = await call('PATCH', '/api/settings/organization', owner, { customDomain: `https://WWW.${domain.toUpperCase()}/propiedades` });
        assert.equal(set.status, 200, JSON.stringify(set.body));
        assert.equal(set.body.customDomain, domain, 'stored bare and lower-case');
        assert.equal(await check(domain), 200);
        assert.equal(await check(`www.${domain}`), 200, 'www. works too');
        assert.equal(await check(`sub.${domain}`), 404, 'other subdomains do not');
        assert.equal((await call('PATCH', '/api/settings/organization', other, { customDomain: domain })).status, 409, 'one brokerage per domain');
        assert.equal(await check('bad host!'), 404);

        // {slug}.PLATFORM_DOMAIN and the reserved platform hosts (only when PLATFORM_DOMAIN is set)
        const base = process.env.PLATFORM_DOMAIN;
        if (base) {
            const slug = (await call('GET', '/api/settings/organization', owner)).body.slug;
            assert.equal(await check(`${slug}.${base}`), 200);
            assert.equal(await check(`app.${base}`), 200);
            assert.equal(await check(`nadie-${run}.${base}`), 404);
            assert.equal(await check(`a.b.${base}`), 404, 'one level only');
            assert.equal((await call('PATCH', '/api/settings/organization', owner, { customDomain: `x.${base}` })).status, 400, 'platform hosts cannot be claimed');
        }

        // Clearing it stops the certificate for new requests
        assert.equal((await call('PATCH', '/api/settings/organization', owner, { customDomain: '' })).body.customDomain, null);
        assert.equal(await check(domain), 404);
    });

    await step('brokerage sites: profile by slug / host, compact index with ETag, listing page, inquiry with consent, events, isolation', async () => {
        const owner = await register('site1');
        const other = await register('site2');
        const agent = (await joinOrg(owner, 'siteagent', 'AGENT')).token;
        const slug = (await call('GET', '/api/settings/organization', owner)).body.slug;
        const otherSlug = (await call('GET', '/api/settings/organization', other)).body.slug;
        const domain = `site-${run}.example.uy`;
        await call('PATCH', '/api/settings/organization', owner, { phone: '473 22 123' });
        const partial = await call('PATCH', '/api/settings/organization', owner, { customDomain: domain, whatsapp: '099 991 525', brandColor: '#1F6F5C' });
        assert.equal(partial.body.whatsapp, '+59899991525');
        assert.equal(partial.body.phone, '+59847322123', 'a field that is not sent keeps its value');

        // Site settings: validation, permissions, safe links only
        assert.equal((await call('PUT', '/api/site-settings', agent, { config: { layout: 'hero' } })).status, 403, 'agents cannot edit the site');
        assert.equal((await call('PUT', '/api/site-settings', owner, { config: { layout: 'neon' } })).status, 400);
        assert.equal((await call('PUT', '/api/site-settings', owner, { config: { social: { instagram: 'javascript:alert(1)' } } })).status, 400);
        assert.equal((await call('PUT', '/api/site-settings', owner, { config: { pages: [{ title: 'Privacidad', body: 'x' }] } })).status, 400, 'reserved page address');
        const saved = await call('PUT', '/api/site-settings', owner, { config: {
            layout: 'hero', font: 'serif', headline: '  Tu casa en Salto  ', email: 'info@castro.test',
            social: { instagram: 'https://instagram.com/castro' }, hours: 'Lun a vie 9–18',
            pages: [{ title: 'Quiénes somos', body: 'Desde 1985.' }, { title: 'Servicios', body: 'Tasaciones.' }],
            banners: [{ title: 'Tasamos tu propiedad', href: '/p/servicios' }],
        } });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        assert.equal(saved.body.config.headline, 'Tu casa en Salto');
        assert.equal(saved.body.config.pages[0].slug, 'quienes-somos');
        assert.equal((await call('GET', '/api/site-settings', agent)).body.config.layout, 'hero', 'members can read it');

        // Profile by slug and by host; unknown → 404; one of the two is required
        const bySlug = await call('GET', `/api/public/site?site=${slug}`);
        assert.equal(bySlug.status, 200, JSON.stringify(bySlug.body));
        assert.equal(bySlug.body.whatsapp, '+59899991525');
        assert.equal(bySlug.body.brandColor, '#1F6F5C');
        assert.equal(bySlug.body.config.font, 'serif');
        assert.equal(bySlug.body.url, `https://${domain}`);
        assert.equal(bySlug.body.language, 'es');
        assert.equal(bySlug.body.noindex, false);
        assert.ok(!('id' in bySlug.body) && !('policies' in bySlug.body), 'no internal fields');
        const byHost = await call('GET', `/api/public/site?host=www.${domain}`);
        assert.equal(byHost.status, 200);
        assert.equal(byHost.body.slug, slug);
        assert.equal((await call('GET', `/api/public/site?host=nadie-${run}.example.uy`)).status, 404);
        assert.equal((await call('GET', `/api/public/site?site=nadie-${run}`)).status, 404);
        assert.equal((await call('GET', '/api/public/site')).status, 400);

        // Listings: public ones only, prices per operation, approximate location shifted, hidden one without coordinates
        const mk = (body: Record<string, unknown>, token = owner) => call('POST', '/api/properties', token, { propertyType: 'CASA', city: 'Salto', state: 'Salto', ...body });
        const casa = await mk({ title: 'Hermosa casa céntrica', address: 'Uruguay 1234', locality: 'Centro', code: `C-${run}`, beds: 4, baths: 2, builtAreaM2: 180,
            amenities: ['parrillero'], lat: -31.3833, lng: -57.9667, geoPrecision: 'APPROX',
            prices: [{ operation: 'SALE', amount: 290000, currency: 'USD' }, { operation: 'RENT', amount: 25000, currency: 'UYU' }] });
        assert.equal(casa.status, 201, JSON.stringify(casa.body));
        assert.equal(casa.body.title, 'Hermosa casa céntrica');
        assert.equal((await call('PATCH', `/api/properties/${casa.body.id}`, owner, { featured: true })).status, 200);
        const campo = await mk({ propertyType: 'CAMPO_CHACRA', locality: 'Colonia Lavalleja', landArea: 120, landAreaUnit: 'HA', lat: -31.2, lng: -57.5, geoPrecision: 'HIDDEN',
            prices: [{ operation: 'SALE', onRequest: true }] });
        assert.equal(campo.status, 201, JSON.stringify(campo.body));
        const hidden = await mk({ address: 'Oculta 1', isPublic: false, price: 1 });
        const sold = await mk({ address: 'Vendida 1', price: 1 });
        const soldPut = await call('PATCH', `/api/properties/${sold.body.id}`, owner, { status: 'SOLD' });
        assert.equal(soldPut.status, 200, JSON.stringify(soldPut.body));
        const foreign = await mk({ address: 'Ajena 1', code: `C-${run}`, price: 1 }, other);
        assert.equal(foreign.status, 201, 'the same code in another brokerage');

        const idxRes = await fetch(`${API}/api/public/listings/index?site=${slug}`);
        assert.equal(idxRes.status, 200);
        assert.match(idxRes.headers.get('cache-control') || '', /s-maxage=60/);
        const etag = idxRes.headers.get('etag');
        assert.ok(etag, 'ETag');
        const idx = await idxRes.json() as any;
        const ids = idx.items.map((i: any) => i.i);
        assert.ok(ids.includes(casa.body.id) && ids.includes(campo.body.id));
        assert.ok(!ids.includes(hidden.body.id), 'not public');
        assert.ok(!ids.includes(sold.body.id), 'sold');
        assert.ok(!ids.includes(foreign.body.id), 'other brokerage');
        const ci = idx.items.find((i: any) => i.i === casa.body.id);
        assert.deepEqual(ci.p, [['SALE', 290000, 'USD', null], ['RENT', 25000, 'UYU', 'MONTH']]);
        assert.equal(ci.c, `C-${run}`);
        assert.equal(ci.ti, 'Hermosa casa céntrica');
        assert.equal(ci.ap, 1);
        assert.notDeepEqual(ci.ll, [-31.3833, -57.9667], 'approximate location is shifted');
        assert.equal(ci.f, 1);
        assert.equal(ci.s, 'hermosa-casa-centrica-centro-salto');
        const cp = idx.items.find((i: any) => i.i === campo.body.id);
        assert.deepEqual(cp.p, [['SALE', null, 'USD', null]], '"Consultar"');
        assert.equal(cp.ll, undefined, 'hidden location');
        assert.equal(cp.lu, 'HA');
        assert.equal(ids[0], casa.body.id, 'featured first');
        const again = await fetch(`${API}/api/public/listings/index?site=${slug}`, { headers: { 'If-None-Match': etag! } });
        assert.equal(again.status, 304, 'unchanged index → 304');
        assert.equal((await call('GET', `/api/public/listings/index?host=${domain}`)).body.count, idx.count, 'same index by host');
        assert.equal((await call('GET', `/api/public/listings/index?site=${otherSlug}`)).body.count, 1);

        // Listing page by "<code>-<slug>", by code and by id; never another brokerage's
        const page = await call('GET', `/api/public/listings/${ci.c}-${ci.s}?site=${slug}`);
        assert.equal(page.status, 200, JSON.stringify(page.body));
        assert.equal(page.body.id, casa.body.id);
        assert.equal(page.body.ref, `C-${run}-hermosa-casa-centrica-centro-salto`);
        assert.equal(page.body.address, null, 'no street address when the location is approximate');
        assert.equal(page.body.approximate, true);
        assert.equal(page.body.prices[0].amount, 290000);
        assert.ok(!('orgId' in page.body) && !('agentId' in page.body));
        assert.equal((await call('GET', `/api/public/listings/${encodeURIComponent(ci.c)}?site=${slug}`)).body.id, casa.body.id);
        assert.equal((await call('GET', `/api/public/listings/${campo.body.id}?site=${slug}`)).status, 200);
        assert.equal((await call('GET', `/api/public/listings/${foreign.body.id}?site=${slug}`)).status, 404, 'isolation: other brokerage by id');
        assert.equal((await call('GET', `/api/public/listings/${casa.body.id}?site=${otherSlug}`)).status, 404, 'isolation: changing the site');
        assert.equal((await call('GET', `/api/public/listings/${casa.body.id}?host=nadie-${run}.example.uy`)).status, 404, 'isolation: unknown host');
        assert.equal((await call('GET', `/api/public/listings/${hidden.body.id}?site=${slug}`)).status, 404, 'not public');
        // The other brokerage's own code answers its own listing
        assert.equal((await call('GET', `/api/public/listings/${ci.c}?site=${otherSlug}`)).body.id, foreign.body.id);

        // Legacy /public-listings/<id> → path on the new site (301 in the web app)
        assert.equal((await call('GET', `/api/public/site?site=${slug}&listing=${casa.body.id}`)).body.listingPath, `/propiedades/${page.body.ref}`);
        assert.equal((await call('GET', `/api/public/site?site=${slug}&listing=${foreign.body.id}`)).body.listingPath, null);

        // Inquiry: consent required (Ley 18.331), honeypot, isolation, lead with consentAt
        const inq = (id: string, body: Record<string, unknown>, site = slug) => call('POST', `/api/public/listings/${id}/inquiry?site=${site}`, undefined, body);
        const noConsent = await inq(casa.body.id, { name: 'Lucía Pérez', phone: '098 123 456' });
        assert.equal(noConsent.status, 400);
        assert.equal(noConsent.body.code, 'CONSENT_REQUIRED');
        assert.equal((await inq(casa.body.id, { name: 'Lucía Pérez', phone: '098 123 456', consent: true }, otherSlug)).status, 404, 'isolation: inquiry through another site');
        assert.equal((await inq(foreign.body.id, { name: 'Lucía Pérez', phone: '098 123 456', consent: true })).status, 404, 'isolation: another brokerage’s listing');
        const ok = await inq(casa.body.id, { name: 'Lucía Pérez', phone: '098 123 456', message: 'Me interesa', consent: true });
        assert.equal(ok.status, 201, JSON.stringify(ok.body));
        const bot = await inq(casa.body.id, { name: 'Bot', phone: '091 000 000', consent: true, website: 'spam.example' });
        assert.equal(bot.status, 201, 'honeypot answers OK');
        const lead = await db().client.findFirst({ where: { phone: '+59898123456', organization: { slug } } });
        assert.ok(lead, 'lead created with the phone in E.164');
        assert.equal(lead!.source, 'Sitio web');
        assert.ok(lead!.consentAt, 'consent recorded');
        assert.equal(await db().client.count({ where: { phone: '+59891000000' } }), 0, 'honeypot: nothing saved');
        assert.equal(await db().client.count({ where: { phone: '+59898123456', organization: { slug: otherSlug } } }), 0);

        // Contact click events
        const ev = (body: Record<string, unknown>, site = slug) => call('POST', `/api/public/events?site=${site}`, undefined, body);
        assert.equal((await ev({ type: 'whatsapp_click', propertyId: casa.body.id })).status, 204);
        assert.equal((await ev({ type: 'whatsapp_click' })).status, 204, 'site-wide button');
        assert.equal((await ev({ type: 'hack' })).status, 400);
        assert.equal((await ev({ type: 'whatsapp_click', propertyId: casa.body.id }, otherSlug)).status, 404, 'isolation: event for another brokerage’s listing');
        const orgId = (await db().organization.findUnique({ where: { slug }, select: { id: true } }))!.id;
        assert.equal(await db().siteEvent.count({ where: { orgId, type: 'whatsapp_click' } }), 2);

        // Demo brokerages: noindex; expired demos are not served
        await db().organization.update({ where: { id: orgId }, data: { isDemo: true } });
        assert.equal((await call('GET', `/api/public/site?site=${slug}`)).body.noindex, true);
        await db().organization.update({ where: { id: orgId }, data: { demoExpiresAt: new Date(Date.now() - 1000) } });
        assert.equal((await call('GET', `/api/public/site?site=${slug}`)).status, 404, 'expired demo');
        assert.equal((await call('GET', `/api/public/listings/index?site=${slug}`)).status, 404);
        await db().organization.update({ where: { id: orgId }, data: { isDemo: false, demoExpiresAt: null } });

        // publicSite off: every site endpoint and Settings > Website answer 404 module_disabled
        assert.equal((await setModules(owner, { publicSite: false })).status, 200);
        assertModuleDisabled(await call('GET', `/api/public/site?site=${slug}`), 'publicSite', 'site');
        assertModuleDisabled(await call('GET', `/api/public/listings/index?site=${slug}`), 'publicSite', 'index');
        assertModuleDisabled(await call('GET', `/api/public/listings/${casa.body.id}?site=${slug}`), 'publicSite', 'listing');
        assertModuleDisabled(await inq(casa.body.id, { name: 'X', phone: '098 000 001', consent: true }), 'publicSite', 'inquiry');
        assertModuleDisabled(await ev({ type: 'whatsapp_click' }), 'publicSite', 'events');
        assertModuleDisabled(await call('GET', '/api/site-settings', owner), 'publicSite', 'site settings');
        assert.equal((await call('GET', `/api/public/site?site=${otherSlug}`)).status, 200, 'other brokerages keep their site');
        assert.equal((await setModules(owner, { publicSite: null })).status, 200);
    });

    await step('module system: list, permissions, per-brokerage override, dependencies, isolation, audit', async () => {
        const owner = a;
        const agent = await joinOrg(owner, 'modagent', 'AGENT');
        const m = await moduleMap(owner);
        assert.equal(Object.keys(m).length, 17);
        assert.equal(m.appointments.enabled, true);
        assert.ok(Object.values(m).every((x: any) => x.enabled), 'all-on run: every module is on (AI via AI_ASSISTANT_ENABLED=true)');
        assert.equal(m.migrator.canEdit, false, 'superadminOnly: a firm admin cannot change it');

        // Permissions and validation
        const ma = await moduleMap(agent.token);
        assert.ok(Object.values(ma).every((x: any) => x.canEdit === false), 'agents read but cannot edit');
        assert.equal((await setModules(agent.token, { appointments: false })).status, 403);
        assert.equal((await setModules(owner, { nope: true } as any)).status, 400);
        assert.equal((await call('PUT', '/api/settings/modules', owner, { modules: { tasks: 'yes' } })).status, 400);
        assert.equal((await setModules(owner, { migrator: true })).status, 403, 'superadminOnly');

        // Off for brokerage A only
        const off = await setModules(owner, { appointments: false, tasks: false });
        assert.equal(off.status, 200, JSON.stringify(off.body));
        assertModuleDisabled(await call('GET', '/api/appointments', owner), 'appointments', 'appointments off');
        assertModuleDisabled(await call('GET', '/api/appointments', agent.token), 'appointments', 'same brokerage, other user');
        assertModuleDisabled(await call('GET', '/api/tasks', owner), 'tasks', 'tasks off');
        assert.equal((await call('GET', '/api/appointments', b)).status, 200, 'the other brokerage is not affected');
        assert.equal((await call('GET', '/api/tasks', b)).status, 200);

        // Saving policies must not wipe the module overrides stored in the same JSON
        assert.equal((await call('PATCH', '/api/settings/policies', owner, { documents: { maxFileSizeMb: 19 } })).status, 200);
        assert.equal((await moduleMap(owner)).appointments.enabled, false, 'policies PATCH keeps modules');

        // Dependencies: deals off turns commissions off; search leaves deals out
        const d = await setModules(owner, { deals: false });
        const dm = Object.fromEntries((d.body.modules as any[]).map(x => [x.key, x]));
        assert.equal(dm.commissions.enabled, false);
        assert.deepEqual(dm.commissions.blockedBy, ['deals']);
        assertModuleDisabled(await call('GET', '/api/finance/metrics', owner), 'commissions', 'commissions blocked by deals');
        assertModuleDisabled(await call('GET', '/api/offers', owner), 'deals', 'offers');
        const sr = await call('GET', '/api/search?q=test', owner);
        assert.equal(sr.status, 200);
        assert.deepEqual(sr.body.transactions, []);

        // Lead routing and the public site (a fresh, active listing: earlier steps close the first one)
        const pub = await call('POST', '/api/properties', owner, { propertyType: 'CASA', address: '7 Public St', city: 'Salto', state: 'Salto', zip: '50000', price: 120000, beds: 2, baths: 1, status: 'ACTIVE' });
        assert.equal(pub.status, 201, JSON.stringify(pub.body));
        const pubId = pub.body.id as string;
        assert.equal((await call('GET', `/api/properties/public/${pubId}`)).status, 200, 'public while the module is on');
        assert.equal((await setModules(owner, { leadRouting: false, publicSite: false })).status, 200);
        assertModuleDisabled(await call('GET', '/api/settings/lead-routing', owner), 'leadRouting', 'lead routing');
        const org = await call('GET', '/api/settings/organization', owner);
        assertModuleDisabled(await call('GET', `/api/properties/public?b=${org.body.slug}`), 'publicSite', 'public listings');
        assertModuleDisabled(await call('GET', `/api/properties/public/${pubId}`), 'publicSite', 'public listing page');
        assertModuleDisabled(await call('POST', `/api/properties/public/${pubId}/inquiry`, undefined, { name: 'X', email: 'x@example.com' }), 'publicSite', 'inquiry');

        // Audit trail
        const log = await call('GET', '/api/settings/organization/audit-log', owner);
        assert.ok(JSON.stringify(log.body).includes('UPDATE_ORG_MODULES'), 'module changes are audited');

        // superadminOnly: a SUPERADMIN can change the importer
        const sa = await joinOrg(owner, 'modsuper', 'MANAGER');
        await db().user.update({ where: { id: sa.id }, data: { role: 'SUPERADMIN' } });
        const mig = await setModules(sa.token, { migrator: true });
        assert.equal(mig.status, 200, JSON.stringify(mig.body));

        // Back to the installation defaults (null removes the override)
        const reset = await setModules(owner, { appointments: null, tasks: null, deals: null, leadRouting: null, publicSite: null });
        assert.equal(reset.status, 200);
        assert.equal((await call('GET', '/api/appointments', owner)).status, 200);
        assert.equal((await call('GET', '/api/finance/metrics', owner)).status, 200);
        assert.equal((await call('GET', `/api/properties/public/${pubId}`)).status, 200);
        assert.equal((await setModules(sa.token, { migrator: null })).status, 200);
    });

    console.log(`\nAll ${passed} smoke checks passed.`);
}

main()
    .then(() => sharedPrisma?.$disconnect())
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
