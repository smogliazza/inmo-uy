/**
 * Unit tests for the module resolution rules (no server or database needed).
 *
 *   npm run test:unit
 */
import assert from 'node:assert/strict';
import { resolveModules, readModuleOverrides, MODULE_KEYS, MODULES, installationModuleEnabled } from '../src/lib/modules';

let passed = 0;
function test(name: string, fn: () => void) {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
}

const env = (vars: Record<string, string> = {}) => ({ ...vars }) as NodeJS.ProcessEnv;

test('registry defaults apply with no env and no override (AI forced off by the legacy flag)', () => {
    const m = resolveModules({}, env());
    for (const k of MODULE_KEYS) {
        const expected = k === 'aiAssistant' ? false : MODULES[k].default;
        assert.equal(m[k].enabled, expected, k);
    }
    assert.equal(m.aiAssistant.source, 'forced_off');
    assert.equal(m.crmLeads.source, 'default');
});

test('MODULES_FORCE_OFF beats an organization override', () => {
    const m = resolveModules({ tasks: true }, env({ MODULES_FORCE_OFF: 'tasks' }));
    assert.equal(m.tasks.enabled, false);
    assert.equal(m.tasks.source, 'forced_off');
    assert.equal(m.tasks.override, true, 'the override is kept, just not applied');
});

test('organization override beats installation defaults, which beat the registry', () => {
    const e = env({ MODULES_DEFAULT_ON: 'deals', MODULES_DEFAULT_OFF: 'documents' });
    const m = resolveModules({ documents: true }, e);
    assert.equal(m.deals.enabled, true);
    assert.equal(m.deals.source, 'installation');
    assert.equal(m.documents.enabled, true);
    assert.equal(m.documents.source, 'organization');
    assert.equal(m.documents.installationDefault, false);
});

test('a module whose requirement is off is off, and says why (chains propagate)', () => {
    const m = resolveModules({ deals: false, commissions: true }, env());
    assert.equal(m.commissions.enabled, false);
    assert.deepEqual(m.commissions.blockedBy, ['deals']);
    const m2 = resolveModules({ crmLeads: false }, env());
    assert.equal(m2.leadRouting.enabled, false);
    assert.deepEqual(m2.leadRouting.blockedBy, ['crmLeads']);
});

test('legacy AI_ASSISTANT_ENABLED=true turns the assistant on by default; brokerages can still turn it off', () => {
    assert.equal(resolveModules({}, env({ AI_ASSISTANT_ENABLED: 'true' })).aiAssistant.enabled, true);
    assert.equal(resolveModules({ aiAssistant: false }, env({ AI_ASSISTANT_ENABLED: 'true' })).aiAssistant.enabled, false);
});

test('env lists accept the "ai" alias, spaces and ignore unknown names', () => {
    const m = resolveModules({}, env({ AI_ASSISTANT_ENABLED: 'true', MODULES_FORCE_OFF: ' ai , billing ,nope' }));
    assert.equal(m.aiAssistant.source, 'forced_off');
    assert.equal(m.billing.source, 'forced_off');
});

test('overrides are read leniently from Organization.policies', () => {
    assert.deepEqual(readModuleOverrides(null), {});
    assert.deepEqual(readModuleOverrides({ modules: [] }), {});
    assert.deepEqual(readModuleOverrides({ crm: {}, modules: { tasks: false, nope: true, deals: 'yes' } }), { tasks: false });
});

test('installation view ignores organization overrides', () => {
    assert.equal(installationModuleEnabled('googleOAuth', env()), false);
    assert.equal(installationModuleEnabled('googleOAuth', env({ MODULES_DEFAULT_ON: 'googleOAuth' })), true);
});

console.log(`\nAll ${passed} module unit tests passed.`);
