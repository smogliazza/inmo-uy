/**
 * Organization.siteConfig (spec 6.3 / 8.4): what each brokerage can change on its public site without custom CSS.
 * Stored as JSON; always read through readSiteConfig() so the site never sees an unexpected shape, and written
 * through parseSiteConfig(), which validates and trims every field.
 */

export const SITE_LAYOUTS = ['classic', 'hero', 'compact'] as const;
export const SITE_FONTS = ['sans', 'serif', 'modern'] as const;
export const SOCIAL_KEYS = ['instagram', 'facebook', 'youtube', 'tiktok', 'linkedin', 'x'] as const;
const RESERVED_PAGE_SLUGS = new Set(['privacidad']); // built in: the privacy policy

export interface SitePage { slug: string; title: string; body: string }
export interface SiteBanner { title: string; text: string | null; imageUrl: string | null; href: string | null }
export interface SiteConfig {
    layout: typeof SITE_LAYOUTS[number];
    font: typeof SITE_FONTS[number];
    headline: string | null;
    subheadline: string | null;
    heroImageUrl: string | null;
    banners: SiteBanner[];
    pages: SitePage[];
    social: Partial<Record<typeof SOCIAL_KEYS[number], string>>;
    email: string | null;
    hours: string | null;
    privacyPolicy: string | null; // null → the site shows the default template (to be reviewed by a local professional)
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
    layout: 'classic', font: 'sans', headline: null, subheadline: null, heroImageUrl: null,
    banners: [], pages: [], social: {}, email: null, hours: null, privacyPolicy: null,
};

// Kept under express.json()'s 100 kB body limit when everything is full
const LIMITS = { pages: 10, banners: 6, pageBody: 6_000, privacy: 20_000 };

const str = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim().slice(0, max);
    return t || null;
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Only http(s) links or site-relative paths: no javascript: or data: URLs on a public page. */
export function safeUrl(v: unknown, allowRelative = false): string | null {
    const s = str(v, 500);
    if (!s) return null;
    if (allowRelative && /^\/(?!\/)[^\s]*$/.test(s)) return s;
    try {
        const u = new URL(s);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
    } catch {
        return null;
    }
}

export const pageSlug = (v: unknown): string =>
    (typeof v === 'string' ? v : '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Lenient read of whatever is stored: unknown keys are dropped, bad values fall back to defaults. */
export function readSiteConfig(raw: unknown): SiteConfig {
    const r = parseSiteConfig(raw, true);
    return r.ok ? r.config : DEFAULT_SITE_CONFIG;
}

/** Strict validation for PATCH requests (lenient=true is used when reading stored data). */
export function parseSiteConfig(raw: unknown, lenient = false): { ok: true; config: SiteConfig } | { ok: false; error: string } {
    if (raw == null) return { ok: true, config: { ...DEFAULT_SITE_CONFIG } };
    if (!isObj(raw)) return { ok: false, error: 'siteConfig must be an object' };
    const fail = (error: string) => (lenient ? null : { ok: false as const, error });

    const layout = (SITE_LAYOUTS as readonly string[]).includes(raw.layout as string) ? raw.layout as SiteConfig['layout'] : 'classic';
    if (raw.layout !== undefined && raw.layout !== layout) { const f = fail(`layout must be one of: ${SITE_LAYOUTS.join(', ')}`); if (f) return f; }
    const font = (SITE_FONTS as readonly string[]).includes(raw.font as string) ? raw.font as SiteConfig['font'] : 'sans';
    if (raw.font !== undefined && raw.font !== font) { const f = fail(`font must be one of: ${SITE_FONTS.join(', ')}`); if (f) return f; }

    const heroImageUrl = safeUrl(raw.heroImageUrl, true);
    if (str(raw.heroImageUrl, 500) && !heroImageUrl) { const f = fail('heroImageUrl must be an http(s) address'); if (f) return f; }

    const email = str(raw.email, 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { const f = fail('Invalid contact email'); if (f) return f; }

    const banners: SiteBanner[] = [];
    if (Array.isArray(raw.banners)) {
        if (raw.banners.length > LIMITS.banners) { const f = fail(`At most ${LIMITS.banners} banners`); if (f) return f; }
        for (const b of raw.banners.slice(0, LIMITS.banners)) {
            if (!isObj(b)) continue;
            const title = str(b.title, 120);
            if (!title) { const f = fail('Every banner needs a title'); if (f) return f; continue; }
            banners.push({ title, text: str(b.text, 400), imageUrl: safeUrl(b.imageUrl, true), href: safeUrl(b.href, true) });
        }
    }

    const pages: SitePage[] = [];
    if (Array.isArray(raw.pages)) {
        if (raw.pages.length > LIMITS.pages) { const f = fail(`At most ${LIMITS.pages} pages`); if (f) return f; }
        const seen = new Set<string>();
        for (const p of raw.pages.slice(0, LIMITS.pages)) {
            if (!isObj(p)) continue;
            const title = str(p.title, 120);
            const slug = pageSlug(p.slug || p.title);
            if (!title || !slug) { const f = fail('Every page needs a title'); if (f) return f; continue; }
            if (seen.has(slug) || RESERVED_PAGE_SLUGS.has(slug)) { const f = fail(`Page address already in use: ${slug}`); if (f) return f; continue; }
            seen.add(slug);
            pages.push({ slug, title, body: str(p.body, LIMITS.pageBody) ?? '' });
        }
    }

    const social: SiteConfig['social'] = {};
    if (isObj(raw.social)) {
        for (const k of SOCIAL_KEYS) {
            const u = safeUrl(raw.social[k]);
            if (str(raw.social[k], 500) && !u) { const f = fail(`Invalid ${k} address`); if (f) return f; }
            if (u) social[k] = u;
        }
    }

    return {
        ok: true,
        config: {
            layout, font,
            headline: str(raw.headline, 120),
            subheadline: str(raw.subheadline, 240),
            heroImageUrl, banners, pages, social, email,
            hours: str(raw.hours, 300),
            privacyPolicy: str(raw.privacyPolicy, LIMITS.privacy),
        },
    };
}
