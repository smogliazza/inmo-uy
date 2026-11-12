/**
 * Module system: everything the platform can do stays in the code, but each brokerage only sees and
 * runs the modules that are on. A module that is off is hidden in the panel, its API answers
 * 404 { error: 'module_disabled' } and its background jobs skip that brokerage.
 *
 * Resolution, highest priority first:
 *   1. MODULES_FORCE_OFF (env)            — off for everyone; nobody can turn it on.
 *   2. Organization.policies.modules      — per-brokerage override (SUPERADMIN / FIRMADMIN; superadminOnly
 *                                           modules only SUPERADMIN).
 *   3. MODULES_DEFAULT_ON / _OFF (env)     — installation defaults.
 *   4. The registry default below.
 *   5. A module whose required module is off is off too.
 *
 * Legacy flag: AI_ASSISTANT_ENABLED !== 'true' keeps the AI assistant forced off, as before; with
 * AI_ASSISTANT_ENABLED=true it becomes on by default and each brokerage can still turn it off.
 *
 * Mirrored (types and labels only) in frontend/src/lib/modules.ts.
 */
import type { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware';
// Loaded lazily so the pure resolution logic can be unit-tested without starting the server.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = () => (require('../server') as typeof import('../server')).prisma;

export interface ModuleDef {
    default: boolean;
    label: string;
    requires?: readonly string[];
    superadminOnly?: boolean;
}

export const MODULES = {
    publicSite:   { default: true,  label: 'Sitio público' },
    publicMap:    { default: true,  label: 'Mapa en sitio público', requires: ['publicSite'] },
    crmLeads:     { default: true,  label: 'CRM de interesados' },
    leadRouting:  { default: true,  label: 'Reparto de consultas', requires: ['crmLeads'] },
    tasks:        { default: true,  label: 'Tareas' },
    appointments: { default: true,  label: 'Visitas y agenda' },
    documents:    { default: true,  label: 'Documentos' },
    rentals:      { default: true,  label: 'Gestión de alquileres' },
    deals:        { default: false, label: 'Ofertas y operaciones de venta' },
    commissions:  { default: false, label: 'Comisiones', requires: ['deals'] },
    marketing:    { default: false, label: 'Marketing' },
    referrals:    { default: false, label: 'Referidos' },
    gifts:        { default: false, label: 'Regalos a clientes' },
    aiAssistant:  { default: false, label: 'Asistente IA' },
    billing:      { default: false, label: 'Suscripción Stripe' },
    googleOAuth:  { default: false, label: 'Ingreso con Google' },
    migrator:     { default: false, label: 'Migrador inmobiliariaya', superadminOnly: true },
} as const satisfies Record<string, ModuleDef>;

export type ModuleKey = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

/** Short names accepted in the env lists (the spec writes `ai` for the assistant). */
const ALIASES: Record<string, ModuleKey> = { ai: 'aiAssistant' };

export type ModuleSource = 'forced_off' | 'organization' | 'installation' | 'default';

export interface ModuleState {
    key: ModuleKey;
    label: string;
    enabled: boolean;
    /** Where the on/off value came from (before dependencies are applied). */
    source: ModuleSource;
    /** The organization's own override, if any. */
    override: boolean | null;
    requires: ModuleKey[];
    /** Required modules that are off, which turn this one off. */
    blockedBy: ModuleKey[];
    superadminOnly: boolean;
    /** The value an organization would get with no override (env + registry). */
    installationDefault: boolean;
}

export type ModuleMap = Record<ModuleKey, ModuleState>;

export function isModuleKey(v: unknown): v is ModuleKey {
    return typeof v === 'string' && Object.prototype.hasOwnProperty.call(MODULES, v);
}

function parseList(raw: string | undefined): Set<ModuleKey> {
    const out = new Set<ModuleKey>();
    for (const part of (raw || '').split(',')) {
        const name = part.trim();
        if (!name) continue;
        const key = isModuleKey(name) ? name : ALIASES[name] ?? ALIASES[name.toLowerCase()];
        if (key) out.add(key);
        else console.warn(`[modules] Unknown module "${name}" in environment, ignored`);
    }
    return out;
}

interface EnvLists { forceOff: Set<ModuleKey>; defaultOn: Set<ModuleKey>; defaultOff: Set<ModuleKey> }

function envLists(env: NodeJS.ProcessEnv): EnvLists {
    const forceOff = parseList(env.MODULES_FORCE_OFF);
    const defaultOn = parseList(env.MODULES_DEFAULT_ON);
    const defaultOff = parseList(env.MODULES_DEFAULT_OFF);
    // Legacy AI switch (kept for compatibility).
    if (env.AI_ASSISTANT_ENABLED === 'true') defaultOn.add('aiAssistant');
    else forceOff.add('aiAssistant');
    return { forceOff, defaultOn, defaultOff };
}

/** Reads the per-organization overrides out of Organization.policies (lenient: junk is ignored). */
export function readModuleOverrides(policies: unknown): Partial<Record<ModuleKey, boolean>> {
    const raw = policies && typeof policies === 'object' ? (policies as Record<string, unknown>).modules : undefined;
    const out: Partial<Record<ModuleKey, boolean>> = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (isModuleKey(k) && typeof v === 'boolean') out[k] = v;
    }
    return out;
}

export function resolveModules(overrides: Partial<Record<ModuleKey, boolean>> = {}, env: NodeJS.ProcessEnv = process.env): ModuleMap {
    const lists = envLists(env);
    const map = {} as ModuleMap;
    for (const key of MODULE_KEYS) {
        const def: ModuleDef = MODULES[key];
        const installationDefault = lists.forceOff.has(key) ? false
            : lists.defaultOn.has(key) ? true
            : lists.defaultOff.has(key) ? false
            : def.default;
        const override = typeof overrides[key] === 'boolean' ? overrides[key]! : null;
        let enabled: boolean; let source: ModuleSource;
        if (lists.forceOff.has(key)) { enabled = false; source = 'forced_off'; }
        else if (override !== null) { enabled = override; source = 'organization'; }
        else if (lists.defaultOn.has(key) || lists.defaultOff.has(key)) { enabled = installationDefault; source = 'installation'; }
        else { enabled = def.default; source = 'default'; }
        map[key] = {
            key, label: def.label, enabled, source, override,
            requires: [...(def.requires ?? [])] as ModuleKey[], blockedBy: [],
            superadminOnly: Boolean(def.superadminOnly), installationDefault,
        };
    }
    // Dependencies: repeat until stable so chains (a → b → c) propagate.
    let changed = true;
    while (changed) {
        changed = false;
        for (const state of Object.values(map)) {
            if (!state.enabled) continue;
            const off = state.requires.filter(r => !map[r].enabled);
            if (off.length) { state.enabled = false; state.blockedBy = off; changed = true; }
        }
    }
    return map;
}

/** Installation-level view (no organization override): used before a user is known, e.g. Google sign-in. */
export function installationModuleEnabled(key: ModuleKey, env: NodeJS.ProcessEnv = process.env): boolean {
    return resolveModules({}, env)[key].enabled;
}

/** Whether a module can be enabled by some organization (not forced off for the whole installation). */
export function moduleForcedOff(key: ModuleKey, env: NodeJS.ProcessEnv = process.env): boolean {
    return envLists(env).forceOff.has(key);
}

// ─── Per-organization lookup with a short cache ───────────────────────────────

const CACHE_MS = 30 * 1000;
const cache = new Map<string, { at: number; map: ModuleMap }>();

export function clearModuleCache(orgId?: string) {
    if (orgId) cache.delete(orgId); else cache.clear();
}

export async function getOrgModules(orgId: string): Promise<ModuleMap> {
    const hit = cache.get(orgId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.map;
    const org = await db().organization.findUnique({ where: { id: orgId }, select: { policies: true } });
    const map = resolveModules(readModuleOverrides(org?.policies));
    cache.set(orgId, { at: Date.now(), map });
    return map;
}

export async function isModuleEnabled(orgId: string, key: ModuleKey): Promise<boolean> {
    return (await getOrgModules(orgId))[key].enabled;
}

/**
 * IDs of the organizations that have `key` off. Background jobs exclude them in their query
 * (`orgId: { notIn }`), so a brokerage with the module off never blocks the batch for the others.
 */
export async function orgIdsWithModuleOff(key: ModuleKey): Promise<string[]> {
    if (moduleForcedOff(key)) {
        const all = await db().organization.findMany({ select: { id: true } });
        return all.map(o => o.id);
    }
    const orgs = await db().organization.findMany({ select: { id: true, policies: true } });
    return orgs.filter(o => !resolveModules(readModuleOverrides(o.policies))[key].enabled).map(o => o.id);
}

export const MODULE_DISABLED = { error: 'module_disabled' } as const;

export function sendModuleDisabled(res: Response, key: ModuleKey) {
    return res.status(404).json({ ...MODULE_DISABLED, module: key });
}

/**
 * Express middleware: 404 module_disabled when any of `keys` is off for the signed-in user's
 * organization. Mount it after authenticateToken (it needs req.user).
 */
export function requireModule(...keys: ModuleKey[]) {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const orgId = req.user?.orgId;
            if (!orgId) return res.status(401).json({ error: 'Unauthorized' });
            const map = await getOrgModules(orgId);
            const off = keys.find(k => !map[k].enabled);
            if (off) return sendModuleDisabled(res, off);
            next();
        } catch (err) {
            next(err);
        }
    };
}
