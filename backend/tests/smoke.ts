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

async function main() {
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
        const bad = await call('POST', '/api/properties', a, { address: '1 Test St', city: 'NYC', state: 'NY', zip: '10001', price: 'abc', beds: 1, baths: 1 });
        assert.equal(bad.status, 400);
        const r = await call('POST', '/api/properties', a, { address: '1 Test St', city: 'New York', state: 'NY', zip: '10001', price: 1000000, beds: 2, baths: 2 });
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
        const p2 = await call('POST', '/api/properties', a, { address: '2 Lead Ave', city: 'New York', state: 'NY', zip: '10002', price: 800000, beds: 1, baths: 1 });
        const detail = await call('GET', `/api/properties/public/${p2.body.id}`);
        assert.equal(detail.status, 200);
        assert.equal(detail.body.agent.name, 'alpha Owner');
        const bad = await call('POST', `/api/properties/public/${p2.body.id}/inquiry`, undefined, { name: 'X' });
        assert.equal(bad.status, 400);
        const r = await call('POST', `/api/properties/public/${p2.body.id}/inquiry`, undefined, { name: 'Web Lead', email: `lead-${run}@example.com`, message: 'Is it available?' });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        const leads = await call('GET', '/api/clients?temperature=HOT', a);
        assert.ok(leads.body.data.some((c: any) => c.source === 'Website'));
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
        const js = await call('POST', '/api/properties', a, { address: '3 Bad Ln', city: 'NY', state: 'NY', zip: '10003', price: 1, beds: 1, baths: 1, virtualTourUrl: 'javascript:alert(1)' });
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
        const prop = await call('POST', '/api/properties', sec, { address: '1 Audit St', city: 'New York', state: 'NY', zip: '10001', price: 500000, beds: 1, baths: 1 });
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
        assert.ok(d.crm.leadSources.includes('Referral'));

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
        const base = { address: '7 Policy St', city: 'New York', state: 'NY', zip: '10007', price: 900000, beds: 2, baths: 1 };

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
            { address: '20 Import Ave', price: 500000, sqft: 700, description: 'Sunny', status: 'Active' },
            { address: '21 Import Ave', price: 500000, description: 'No size' },
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
            const p = await call('POST', '/api/properties', token, { address: `${label} Fin St`, city: 'New York', state: 'NY', zip: '10001', price, beds: 1, baths: 1 });
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

    console.log(`\nAll ${passed} smoke checks passed.`);
}

main()
    .then(() => sharedPrisma?.$disconnect())
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
