/**
 * Uruguay localization helpers (spec, section 7.3).
 *
 * - Phones are stored in E.164 (+598…) when they can be recognized as Uruguayan; anything else is kept
 *   as typed (trimmed), so foreign or partial numbers are never mangled.
 * - Cities / localities are created on the fly per brokerage: extra spaces removed, capitalized, and
 *   matched to an existing spelling regardless of accents or case ("Termas del Dayman" = "Termas del Daymán").
 */

/** "099 991 525" → "+59899991525"; "2400 1234" → "+59824001234". Unrecognized input is returned trimmed. */
export function normalizePhoneUY(raw: string | null | undefined): string | null {
    if (raw === null || raw === undefined) return null;
    const typed = String(raw).trim();
    if (!typed) return null;
    const plus = typed.startsWith('+');
    let digits = typed.replace(/\D/g, '');
    if (!digits) return typed;
    if (plus) return /^598\d{8}$/.test(digits) ? `+${digits}` : typed; // already international: keep foreign ones as typed
    if (digits.startsWith('00598')) digits = digits.slice(2);
    if (/^598\d{8}$/.test(digits)) return `+${digits}`;
    if (/^09\d{7}$/.test(digits)) return `+598${digits.slice(1)}`;   // mobile 09X XXX XXX
    if (/^9\d{7}$/.test(digits)) return `+598${digits}`;             // mobile without the leading 0
    if (/^[24]\d{7}$/.test(digits)) return `+598${digits}`;          // landline (Montevideo 2, interior 4)
    return typed;
}

/** Display form: "+59899991525" → "099 991 525", "+59824001234" → "2400 1234"; anything else unchanged. */
export function formatPhoneUY(e164: string | null | undefined): string {
    if (!e164) return '';
    const m = /^\+598(\d{8})$/.exec(e164);
    if (!m) return e164;
    const n = m[1];
    if (n.startsWith('9')) return `0${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
    return `${n.slice(0, 4)} ${n.slice(4)}`;
}

const LOWER_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en']);

/** "  termas  DEL dayman " → "Termas del Dayman". */
export function normalizePlaceName(raw: string | null | undefined): string | null {
    if (raw === null || raw === undefined) return null;
    const words = String(raw).trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    if (!words.length) return null;
    return words.map((w, i) => {
        const lower = w.toLocaleLowerCase('es-UY');
        if (i > 0 && LOWER_WORDS.has(lower)) return lower;
        // Keep the capitalization of each part of hyphenated names (e.g. "Punta-Ballena")
        return lower.split('-').map(p => p.charAt(0).toLocaleUpperCase('es-UY') + p.slice(1)).join('-');
    }).join(' ');
}

/** Accent- and case-insensitive key used to deduplicate place names. */
export function placeKey(name: string): string {
    return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes `raw` and, when the brokerage already uses the same place with another spelling, returns
 * that existing spelling. `existing` is the list of names already stored for the brokerage.
 */
export function matchPlaceName(raw: string | null | undefined, existing: Iterable<string | null>): string | null {
    const name = normalizePlaceName(raw);
    if (!name) return null;
    const key = placeKey(name);
    for (const e of existing) if (e && placeKey(e) === key) return e;
    return name;
}
