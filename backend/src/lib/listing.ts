/**
 * Listing data for Uruguay (spec section 6): parsing of the new fields and of the prices per operation.
 *
 * - A property can be for sale and for rent at the same time: one PropertyPrice row per operation.
 * - An amount can be missing when the price is "Consultar" (onRequest).
 * - Property.price (legacy Float) stays in sync for reports, the dashboard and commissions:
 *   the active sale price if there is one, else the active rent price, else null.
 */
import { Prisma } from '@prisma/client';
import { ALL_PROPERTY_TYPES, CURRENCIES } from './catalogs';

export const OPERATIONS = ['SALE', 'RENT', 'SEASONAL_RENT'] as const;
export const RENT_PERIODS = ['MONTH', 'WEEK', 'NIGHT', 'SEASON'] as const;
export const GEO_PRECISIONS = ['EXACT', 'APPROX', 'HIDDEN'] as const;
export const AREA_UNITS = ['M2', 'HA'] as const;

export type Operation = typeof OPERATIONS[number];

export interface PriceInput {
    operation: Operation;
    amount: Prisma.Decimal | null;
    currency: typeof CURRENCIES[number];
    period: typeof RENT_PERIODS[number] | null;
    onRequest: boolean;
    isActive: boolean;
}

/** Amounts as typed in Uruguay or plain numbers: "290.000" → 290000, "14,39" → 14.39, "US$ 1.250.000" → 1250000. */
export function parseAmount(v: unknown): number | null | 'invalid' {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : 'invalid';
    if (typeof v !== 'string') return 'invalid';
    let s = v.replace(/US\$|U\$S|\$|UYU|USD|UI|UR|\s/gi, '');
    if (!s) return null;
    // es-UY: dots for thousands and a comma for decimals ("1.250.000", "14,39"). A comma followed by exactly
    // three digits ("2,900") is read as a thousands separator, as in the CSV exports of the original app.
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');                                                                                    // 1,250,000.50
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : 'invalid';
}

/**
 * Validates `prices` from a request: a list of { operation, amount, currency, period, onRequest, isActive }.
 * Returns the parsed rows or an error message.
 */
export function parsePrices(raw: unknown, defaultCurrency: string): { ok: true; prices: PriceInput[] } | { ok: false; error: string } {
    if (!Array.isArray(raw)) return { ok: false, error: 'prices must be a list of { operation, amount, currency }' };
    const out: PriceInput[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') return { ok: false, error: 'Each price must be an object' };
        const r = item as Record<string, unknown>;
        if (!OPERATIONS.includes(r.operation as Operation)) return { ok: false, error: `operation must be one of: ${OPERATIONS.join(', ')}` };
        const operation = r.operation as Operation;
        if (out.some(p => p.operation === operation)) return { ok: false, error: `Only one price per operation (${operation} appears twice)` };
        const amount = parseAmount(r.amount);
        if (amount === 'invalid') return { ok: false, error: `Invalid amount for ${operation}` };
        const currency = (r.currency ?? defaultCurrency) as string;
        if (!(CURRENCIES as readonly string[]).includes(currency)) return { ok: false, error: `currency must be one of: ${CURRENCIES.join(', ')}` };
        const onRequest = r.onRequest === true || amount === null;
        let period: PriceInput['period'] = null;
        if (operation !== 'SALE') {
            const p = r.period ?? (operation === 'RENT' ? 'MONTH' : null);
            if (p !== null && !RENT_PERIODS.includes(p as typeof RENT_PERIODS[number])) return { ok: false, error: `period must be one of: ${RENT_PERIODS.join(', ')}` };
            period = p as PriceInput['period'];
        }
        out.push({
            operation, currency: currency as PriceInput['currency'], period, onRequest,
            amount: amount === null || onRequest && amount === 0 ? null : new Prisma.Decimal(amount),
            isActive: r.isActive !== false,
        });
    }
    return { ok: true, prices: out };
}

/** The legacy Property.price for a set of prices: sale first, then rent, then seasonal; null when "Consultar". */
export function legacyPrice(prices: { operation: string; amount: Prisma.Decimal | number | null; isActive: boolean }[]): number | null {
    for (const op of OPERATIONS) {
        const p = prices.find(x => x.operation === op && x.isActive && x.amount !== null);
        if (p) return Number(p.amount);
    }
    return null;
}

/** Replaces a property's prices: rows not sent are kept but deactivated (nothing is deleted). */
export async function savePrices(tx: Prisma.TransactionClient, propertyId: string, orgId: string, prices: PriceInput[]) {
    const sent = new Set(prices.map(p => p.operation));
    for (const p of prices) {
        await tx.propertyPrice.upsert({
            where: { propertyId_operation: { propertyId, operation: p.operation } },
            create: { propertyId, orgId, ...p },
            update: { amount: p.amount, currency: p.currency, period: p.period, onRequest: p.onRequest, isActive: p.isActive },
        });
    }
    await tx.propertyPrice.updateMany({ where: { propertyId, orgId, operation: { notIn: [...sent] }, isActive: true }, data: { isActive: false } });
    const all = await tx.propertyPrice.findMany({ where: { propertyId, orgId } });
    await tx.property.update({ where: { id: propertyId }, data: { price: legacyPrice(all) } });
    return all;
}

// ─── Other Uruguay fields ─────────────────────────────────────────────────────

const optText = (v: unknown, max: number): string | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const s = String(v).trim().slice(0, max);
    return s === '' ? null : s;
};
const optNum = (v: unknown, opts: { int?: boolean; min?: number; max?: number } = {}): number | null | undefined | 'invalid' => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    // Coordinates are negative in Uruguay: parse the magnitude and keep the sign
    const str = typeof v === 'number' ? null : String(v).trim();
    const negative = typeof v === 'number' ? v < 0 : str!.startsWith('-');
    const parsed = parseAmount(typeof v === 'number' ? Math.abs(v) : str!.replace(/^-/, ''));
    if (parsed === null) return null;
    if (parsed === 'invalid') return 'invalid';
    const n = negative ? -parsed : parsed;
    if (opts.min !== undefined && n < opts.min) return 'invalid';
    if (opts.max !== undefined && n > opts.max) return 'invalid';
    return opts.int ? Math.round(n) : n;
};

/**
 * Parses the Uruguay fields of a create / update body. Only keys present in the body are returned.
 * Returns an error message for invalid values.
 */
export function parseUyFields(body: Record<string, unknown>, catalog: { amenities: string[] }): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
    const data: Record<string, unknown> = {};
    for (const [k, max] of [['title', 120], ['code', 40], ['locality', 120], ['padron', 40], ['externalUrl', 500]] as const) {
        const v = optText(body[k], max);
        if (v !== undefined) data[k] = v;
    }
    if (body.slug !== undefined) {
        const s = optText(body.slug, 120);
        data.slug = s ? s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || null : null;
    }
    for (const [k, opts] of [
        ['lat', { min: -90, max: 90 }], ['lng', { min: -180, max: 180 }],
        ['builtAreaM2', { min: 0 }], ['landArea', { min: 0 }],
        ['garageSpaces', { int: true, min: 0, max: 500 }],
        ['beds', { min: 0, max: 200 }], ['baths', { min: 0, max: 200 }],
    ] as const) {
        const v = optNum(body[k], opts);
        if (v === 'invalid') return { ok: false, error: `Invalid ${k}` };
        if (v !== undefined) data[k] = v;
    }
    if (body.isPublic !== undefined) data.isPublic = body.isPublic === true || body.isPublic === 'true';
    if (body.furnished !== undefined) data.furnished = body.furnished === true || body.furnished === 'true';
    if (body.geoPrecision !== undefined) {
        if (!GEO_PRECISIONS.includes(body.geoPrecision as typeof GEO_PRECISIONS[number])) return { ok: false, error: `geoPrecision must be one of: ${GEO_PRECISIONS.join(', ')}` };
        data.geoPrecision = body.geoPrecision;
    }
    if (body.landAreaUnit !== undefined) {
        if (body.landAreaUnit !== null && !AREA_UNITS.includes(body.landAreaUnit as typeof AREA_UNITS[number])) return { ok: false, error: 'landAreaUnit must be M2 or HA' };
        data.landAreaUnit = body.landAreaUnit;
    }
    if (body.hoaFeeCurrency !== undefined) {
        if (body.hoaFeeCurrency !== null && !(CURRENCIES as readonly string[]).includes(body.hoaFeeCurrency as string)) return { ok: false, error: `hoaFeeCurrency must be one of: ${CURRENCIES.join(', ')}` };
        data.hoaFeeCurrency = body.hoaFeeCurrency;
    }
    if (body.amenities !== undefined) {
        if (!Array.isArray(body.amenities)) return { ok: false, error: 'amenities must be a list' };
        const allowed = new Set(catalog.amenities);
        const list = [...new Set(body.amenities.map(a => String(a).trim()).filter(Boolean))];
        const unknown = list.find(a => !allowed.has(a));
        if (unknown) return { ok: false, error: `Unknown amenity: ${unknown}` };
        data.amenities = list;
    }
    if (data.landArea != null && data.landAreaUnit === undefined && body.landAreaUnit === undefined) data.landAreaUnit = 'M2';
    return { ok: true, data };
}

export function validPropertyType(t: unknown): t is string {
    return typeof t === 'string' && (ALL_PROPERTY_TYPES as readonly string[]).includes(t);
}

/**
 * Coordinates as the public site may show them (spec 8.3): EXACT as stored; APPROX moved by up to ~300 m
 * in a direction fixed per property (the same every time, so it cannot be averaged out); HIDDEN removed.
 */
export function publicCoords<T extends { id: string; lat?: number | null; lng?: number | null; geoPrecision?: string | null }>(p: T): T {
    if (p.lat == null || p.lng == null) return p;
    if (p.geoPrecision === 'HIDDEN') return { ...p, lat: null, lng: null };
    if (p.geoPrecision !== 'APPROX') return p;
    let h = 0;
    for (const ch of p.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const angle = (h % 360) * Math.PI / 180;
    const meters = 150 + (h % 150);                       // 150–300 m
    const dLat = (meters * Math.cos(angle)) / 111_320;
    const dLng = (meters * Math.sin(angle)) / (111_320 * Math.cos(p.lat * Math.PI / 180));
    const round = (n: number) => Math.round(n * 1e4) / 1e4; // ~11 m grid on top
    return { ...p, lat: round(p.lat + dLat), lng: round(p.lng + dLng) };
}
