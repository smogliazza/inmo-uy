/**
 * Settings policies (organization-wide) and preferences (per user).
 *
 * One place defines every option: its default, its allowed values and its
 * validation. Defaults reproduce the behaviour the app had before these
 * settings existed, so nothing changes for a brokerage until an admin edits it.
 *
 * Stored as JSON (`Organization.policies`, `User.preferences`). Reading is
 * lenient (bad or missing values fall back to defaults); writing is strict
 * (anything invalid is rejected with a message the settings page can show).
 */

import { ALL_PROPERTY_TYPES, PROPERTY_TYPES_UY, AMENITIES_UY, LEAD_SOURCES_UY } from './catalogs';

// ─── Option lists ────────────────────────────────────────────────────────────

export const CLIENT_REQUIRED_FIELD_OPTIONS = ['phone', 'email', 'budget', 'source'] as const;
// propertyType is always required now (spec 6.1); it stays in the list so stored policies remain valid.
export const LISTING_REQUIRED_FIELD_OPTIONS = [
    'sqft', 'propertyType', 'neighborhood', 'description', 'yearBuilt',
    'beds', 'baths', 'builtAreaM2', 'landArea', 'locality', 'code', 'padron', 'state',
] as const;
/** Bedrooms and bathrooms are only asked for housing (spec 6.1: "dormitorios en casas y apartamentos"). */
export const RESIDENTIAL_TYPES = ['APARTAMENTO', 'CASA', 'CONDO', 'COOP', 'TOWNHOUSE', 'SINGLE_FAMILY', 'MULTI_FAMILY'];
export const DOCUMENT_FORMAT_OPTIONS = ['pdf', 'word', 'image'] as const;
export const CLIENT_VISIBILITY_OPTIONS = ['own', 'all'] as const;
export const LISTING_CREATOR_OPTIONS = ['ALL_STAFF', 'MANAGERS'] as const;
export const BUFFER_MINUTE_OPTIONS = [0, 10, 15, 30, 60] as const;
export const APPOINTMENT_DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;
export const REMINDER_LEAD_HOUR_OPTIONS = [1, 2, 4, 12, 24] as const;
export const PREF_CLIENT_TYPE_OPTIONS = ['BUYER', 'SELLER', 'RENTER', 'INVESTOR'] as const;
export const PREF_FUNNEL_STAGE_OPTIONS = ['LEAD', 'QUALIFIED', 'SHOWING'] as const;
export const PREF_LISTING_STATUS_OPTIONS = ['ACTIVE', 'COMING_SOON'] as const;

export type ClientRequiredField = typeof CLIENT_REQUIRED_FIELD_OPTIONS[number];
export type ListingRequiredField = typeof LISTING_REQUIRED_FIELD_OPTIONS[number];
export type DocumentFormat = typeof DOCUMENT_FORMAT_OPTIONS[number];

// ─── Shapes ──────────────────────────────────────────────────────────────────

export interface OrgPolicies {
    crm: {
        requiredFields: ClientRequiredField[];      // first name is always required
        maxClientsPerAgent: number;                 // 0 = no limit; counts open clients (not closed / archived)
        clientVisibility: typeof CLIENT_VISIBILITY_OPTIONS[number]; // 'all' lets agents read (not edit) every client
        duplicateCheck: boolean;                    // warn when an email / phone already exists
        leadSources: string[];                      // suggestions shown in the client form
    };
    properties: {
        whoCanCreate: typeof LISTING_CREATOR_OPTIONS[number];
        requiredFields: ListingRequiredField[];     // on top of address, city, state, zip, price, beds, baths
        photosRequiredToActivate: number;           // 0 = none; photos needed before a listing can be Active
        maxPhotosPerListing: number;                // 0 = no limit
        descriptionMaxChars: number;                // 0 = no limit
        propertyTypes: string[];                    // catalog shown in forms and filters (default: Uruguay)
        amenities: string[];                        // amenity catalog (default: Uruguay)
        usStyleDeal: boolean;                       // show New York deal concepts (board package, MLS #, StreetEasy…)
    };
    finance: {
        showAgentGross: boolean;                    // false hides other agents' production in the leaderboard
        fiscalYearStartMonth: number;               // 1–12; drives the "year to date" figures
    };
    appointments: {
        workdayStart: string;                       // 'HH:MM' — calendar visible range
        workdayEnd: string;
        showWeekends: boolean;
        preventDoubleBooking: boolean;              // refuse overlapping appointments for one agent
        bufferMinutes: number;                      // gap kept between two appointments (needs preventDoubleBooking)
    };
    documents: {
        allowedFormats: DocumentFormat[];
        maxFileSizeMb: number;                      // 1–20 (the server hard cap is 20)
    };
}

export interface UserPreferences {
    crm: {
        defaultClientType: typeof PREF_CLIENT_TYPE_OPTIONS[number];
        defaultFunnelStage: typeof PREF_FUNNEL_STAGE_OPTIONS[number];
        showBudget: boolean;
        compactList: boolean;
    };
    properties: {
        defaultStatus: typeof PREF_LISTING_STATUS_OPTIONS[number];
    };
    finance: {
        showLeaderboard: boolean;
        showIncomeOnDashboard: boolean;
    };
    appointments: {
        defaultDurationMin: number;
        reminderLeadHours: number;
        autoConfirm: boolean;
    };
}

// Uruguay defaults (spec 5.4). The previous New York list is kept for reference: a brokerage can add any of them.
export const LEGACY_LEAD_SOURCES = [
    'Referral', 'Website', 'Zillow', 'StreetEasy', 'Realtor.com',
    'Open House', 'Sign Call', 'Social Media', 'Past Client', 'Sphere',
];
export const DEFAULT_LEAD_SOURCES = [...LEAD_SOURCES_UY];

export const DEFAULT_ORG_POLICIES: OrgPolicies = {
    crm: { requiredFields: [], maxClientsPerAgent: 0, clientVisibility: 'own', duplicateCheck: true, leadSources: DEFAULT_LEAD_SOURCES },
    properties: {
        whoCanCreate: 'ALL_STAFF', requiredFields: [], photosRequiredToActivate: 0, maxPhotosPerListing: 0, descriptionMaxChars: 0,
        propertyTypes: [...PROPERTY_TYPES_UY], amenities: [...AMENITIES_UY], usStyleDeal: false,
    },
    finance: { showAgentGross: true, fiscalYearStartMonth: 1 },
    appointments: { workdayStart: '09:00', workdayEnd: '18:00', showWeekends: true, preventDoubleBooking: false, bufferMinutes: 0 },
    documents: { allowedFormats: ['pdf', 'word', 'image'], maxFileSizeMb: 20 },
};

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
    crm: { defaultClientType: 'BUYER', defaultFunnelStage: 'LEAD', showBudget: true, compactList: false },
    properties: { defaultStatus: 'ACTIVE' },
    finance: { showLeaderboard: true, showIncomeOnDashboard: true },
    appointments: { defaultDurationMin: 60, reminderLeadHours: 24, autoConfirm: false },
};

// ─── Field parsers (each throws Error(message) on an invalid value) ──────────

type Parser<T> = (v: unknown) => T;

const bool = (label: string): Parser<boolean> => v => {
    if (typeof v !== 'boolean') throw new Error(`${label} must be true or false`);
    return v;
};

const oneOf = <T extends string | number>(label: string, options: readonly T[]): Parser<T> => v => {
    if (!options.includes(v as T)) throw new Error(`${label} must be one of: ${options.join(', ')}`);
    return v as T;
};

const intRange = (label: string, min: number, max: number, allowZero = false): Parser<number> => v => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isInteger(n) || !((allowZero && n === 0) || (n >= min && n <= max))) {
        throw new Error(`${label} must be ${allowZero ? '0 (off) or ' : ''}a whole number between ${min} and ${max}`);
    }
    return n;
};

const subsetOf = <T extends string>(label: string, options: readonly T[], allowEmpty: boolean): Parser<T[]> => v => {
    if (!Array.isArray(v)) throw new Error(`${label} must be a list`);
    const out: T[] = [];
    for (const item of v) {
        if (!options.includes(item as T)) throw new Error(`${label}: "${String(item)}" is not allowed (use: ${options.join(', ')})`);
        if (!out.includes(item as T)) out.push(item as T);
    }
    if (!allowEmpty && out.length === 0) throw new Error(`${label} needs at least one choice`);
    return options.filter(o => out.includes(o)); // keep a stable order
};

const timeOfDay = (label: string): Parser<string> => v => {
    if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new Error(`${label} must be a time like 09:00`);
    return v;
};

// A free list of short texts (trimmed, deduplicated case-insensitively)
const textList = (label: string, maxItems: number, maxLen: number): Parser<string[]> => v => {
    if (!Array.isArray(v)) throw new Error(`${label} must be a list`);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of v) {
        if (typeof item !== 'string') throw new Error(`${label} must be text`);
        const s = item.trim();
        if (!s) continue;
        if (s.length > maxLen) throw new Error(`Each entry in ${label} can have at most ${maxLen} characters`);
        if (seen.has(s.toLowerCase())) continue;
        seen.add(s.toLowerCase());
        out.push(s);
    }
    if (out.length === 0) throw new Error(`${label}: add at least one entry`);
    if (out.length > maxItems) throw new Error(`${label}: at most ${maxItems} entries`);
    return out;
};
const sourceList = textList('Lead sources', 30, 40);

const ORG_FIELDS: { [S in keyof OrgPolicies]: { [K in keyof OrgPolicies[S]]: Parser<OrgPolicies[S][K]> } } = {
    crm: {
        requiredFields: subsetOf('Required client fields', CLIENT_REQUIRED_FIELD_OPTIONS, true),
        maxClientsPerAgent: intRange('Max clients per agent', 1, 10000, true),
        clientVisibility: oneOf('Client visibility', CLIENT_VISIBILITY_OPTIONS),
        duplicateCheck: bool('Duplicate check'),
        leadSources: sourceList,
    },
    properties: {
        whoCanCreate: oneOf('Who can create listings', LISTING_CREATOR_OPTIONS),
        requiredFields: subsetOf('Required listing fields', LISTING_REQUIRED_FIELD_OPTIONS, true),
        photosRequiredToActivate: intRange('Photos required before a listing goes Active', 1, 30, true),
        maxPhotosPerListing: intRange('Max photos per listing', 1, 200, true),
        descriptionMaxChars: intRange('Max description length', 100, 10000, true),
        propertyTypes: subsetOf('Property types', ALL_PROPERTY_TYPES, false),
        amenities: textList('Amenities', 60, 40),
        usStyleDeal: bool('New York deal concepts'),
    },
    finance: {
        showAgentGross: bool('Show agent production'),
        fiscalYearStartMonth: intRange('Fiscal year start month', 1, 12),
    },
    appointments: {
        workdayStart: timeOfDay('Workday start'),
        workdayEnd: timeOfDay('Workday end'),
        showWeekends: bool('Show weekends'),
        preventDoubleBooking: bool('Prevent double booking'),
        bufferMinutes: oneOf('Buffer between appointments', BUFFER_MINUTE_OPTIONS),
    },
    documents: {
        allowedFormats: subsetOf('Allowed document formats', DOCUMENT_FORMAT_OPTIONS, false),
        maxFileSizeMb: intRange('Max file size', 1, 20),
    },
};

const PREF_FIELDS: { [S in keyof UserPreferences]: { [K in keyof UserPreferences[S]]: Parser<UserPreferences[S][K]> } } = {
    crm: {
        defaultClientType: oneOf('Default client type', PREF_CLIENT_TYPE_OPTIONS),
        defaultFunnelStage: oneOf('Default stage', PREF_FUNNEL_STAGE_OPTIONS),
        showBudget: bool('Show budget'),
        compactList: bool('Compact list'),
    },
    properties: { defaultStatus: oneOf('Default listing status', PREF_LISTING_STATUS_OPTIONS) },
    finance: { showLeaderboard: bool('Show leaderboard'), showIncomeOnDashboard: bool('Show income on dashboard') },
    appointments: {
        defaultDurationMin: oneOf('Default duration', APPOINTMENT_DURATION_OPTIONS),
        reminderLeadHours: oneOf('Reminder lead time', REMINDER_LEAD_HOUR_OPTIONS),
        autoConfirm: bool('Auto-confirm'),
    },
};

// ─── Generic read / validate machinery ───────────────────────────────────────

type Sections = Record<string, Record<string, unknown>>;

function readLenient<T extends Sections>(defaults: T, fields: Record<string, Record<string, Parser<unknown>>>, raw: unknown): T {
    const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
    const out: Sections = {};
    for (const section of Object.keys(defaults)) {
        out[section] = {};
        const sectionSrc = src[section] && typeof src[section] === 'object' ? src[section] : {};
        for (const key of Object.keys(defaults[section])) {
            let value = defaults[section][key];
            if (key in sectionSrc) {
                try { value = fields[section][key](sectionSrc[key]); } catch { /* keep the default */ }
            }
            out[section][key] = Array.isArray(value) ? [...value] : value;
        }
    }
    return out as T;
}

function applyStrict<T extends Sections>(current: T, fields: Record<string, Record<string, Parser<unknown>>>, patch: unknown):
    { ok: true; value: T; changed: boolean } | { ok: false; error: string } {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, error: 'Send an object such as { "crm": { ... } }' };
    const next: Sections = JSON.parse(JSON.stringify(current));
    let changed = false;
    for (const [section, values] of Object.entries(patch as Record<string, unknown>)) {
        if (!(section in fields)) return { ok: false, error: `Unknown settings section: ${section}` };
        if (!values || typeof values !== 'object' || Array.isArray(values)) return { ok: false, error: `${section} must be an object` };
        for (const [key, raw] of Object.entries(values as Record<string, unknown>)) {
            const parser = fields[section][key];
            if (!parser) return { ok: false, error: `Unknown setting: ${section}.${key}` };
            try {
                const parsed = parser(raw);
                if (JSON.stringify(parsed) !== JSON.stringify(next[section][key])) changed = true;
                next[section][key] = parsed;
            } catch (e) {
                return { ok: false, error: (e as Error).message };
            }
        }
    }
    return { ok: true, value: next as T, changed };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function normalizeOrgPolicies(raw: unknown): OrgPolicies {
    const p = readLenient(DEFAULT_ORG_POLICIES as unknown as Sections, ORG_FIELDS as any, raw) as unknown as OrgPolicies;
    // Keep related values consistent even if one was changed on its own
    if (p.appointments.workdayStart >= p.appointments.workdayEnd) {
        p.appointments.workdayStart = DEFAULT_ORG_POLICIES.appointments.workdayStart;
        p.appointments.workdayEnd = DEFAULT_ORG_POLICIES.appointments.workdayEnd;
    }
    return p;
}

export function applyOrgPoliciesPatch(current: OrgPolicies, patch: unknown):
    { ok: true; value: OrgPolicies; changed: boolean } | { ok: false; error: string } {
    const r = applyStrict(current as unknown as Sections, ORG_FIELDS as any, patch);
    if (!r.ok) return r;
    const v = r.value as unknown as OrgPolicies;
    if (v.appointments.workdayStart >= v.appointments.workdayEnd) return { ok: false, error: 'Workday start must be earlier than workday end' };
    if (v.properties.maxPhotosPerListing > 0 && v.properties.photosRequiredToActivate > v.properties.maxPhotosPerListing) {
        return { ok: false, error: 'Photos required before Active cannot be more than the maximum photos per listing' };
    }
    return { ok: true, value: v, changed: r.changed };
}

export function normalizePreferences(raw: unknown): UserPreferences {
    return readLenient(DEFAULT_USER_PREFERENCES as unknown as Sections, PREF_FIELDS as any, raw) as unknown as UserPreferences;
}

export function applyPreferencesPatch(current: UserPreferences, patch: unknown):
    { ok: true; value: UserPreferences; changed: boolean } | { ok: false; error: string } {
    const r = applyStrict(current as unknown as Sections, PREF_FIELDS as any, patch);
    if (!r.ok) return r;
    return { ok: true, value: r.value as unknown as UserPreferences, changed: r.changed };
}

// ─── Small pure helpers used by the routes ───────────────────────────────────

const CLIENT_FIELD_LABELS: Record<ClientRequiredField, string> = { phone: 'Phone', email: 'Email', budget: 'Budget', source: 'Lead source' };
const LISTING_FIELD_LABELS: Record<ListingRequiredField, string> = {
    sqft: 'Square footage', propertyType: 'Property type', neighborhood: 'Neighborhood', description: 'Description', yearBuilt: 'Year built',
    beds: 'Bedrooms', baths: 'Bathrooms', builtAreaM2: 'Built area (m²)', landArea: 'Land area', locality: 'Locality',
    code: 'Property code', padron: 'Padrón', state: 'Department',
};

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && !Number.isFinite(v));

/** First required client field that is empty in `data`, or null. `onlyPresent` checks just the keys being edited. */
export function missingClientField(policy: OrgPolicies['crm'], data: Record<string, unknown>, onlyPresent = false): string | null {
    for (const f of policy.requiredFields) {
        if (onlyPresent && !(f in data)) continue;
        if (blank(data[f])) return `${CLIENT_FIELD_LABELS[f]} is required by your brokerage's CRM policy`;
    }
    return null;
}

/** First required listing field that is empty in `data`, or null. */
export function missingListingField(policy: OrgPolicies['properties'], data: Record<string, unknown>, onlyPresent = false, propertyType?: string | null): string | null {
    for (const f of policy.requiredFields) {
        if (onlyPresent && !(f in data)) continue;
        // Bedrooms / bathrooms only for housing; a campo or a local comercial does not need them
        if ((f === 'beds' || f === 'baths') && propertyType && !RESIDENTIAL_TYPES.includes(propertyType)) continue;
        if (blank(data[f])) return `${LISTING_FIELD_LABELS[f]} is required by your brokerage's listing policy`;
    }
    return null;
}

export function descriptionTooLong(policy: OrgPolicies['properties'], description: unknown): string | null {
    if (policy.descriptionMaxChars > 0 && typeof description === 'string' && description.length > policy.descriptionMaxChars) {
        return `The description can have at most ${policy.descriptionMaxChars} characters (it has ${description.length})`;
    }
    return null;
}

const FORMAT_MIMES: Record<DocumentFormat, string[]> = {
    pdf: ['application/pdf'],
    word: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
};

export function documentFormatAllowed(policy: OrgPolicies['documents'], mime: string): boolean {
    return policy.allowedFormats.some(f => FORMAT_MIMES[f].includes(mime.toLowerCase()));
}

export function describeAllowedFormats(policy: OrgPolicies['documents']): string {
    const names: Record<DocumentFormat, string> = { pdf: 'PDF', word: 'Word (DOC, DOCX)', image: 'images (JPG, PNG, WebP, GIF)' };
    return policy.allowedFormats.map(f => names[f]).join(', ');
}

/** Start of the fiscal year that contains `now` (month is 1–12). */
export function fiscalYearStart(now: Date, startMonth: number): Date {
    const year = now.getMonth() + 1 >= startMonth ? now.getFullYear() : now.getFullYear() - 1;
    return new Date(year, startMonth - 1, 1);
}
