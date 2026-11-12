/**
 * Listing photos (spec 8.4): every uploaded photo gets WebP copies at 400, 1024 and 1920 px wide
 * (never enlarged); the original is kept. The public site serves them with srcset/sizes.
 */
import sharp from 'sharp';
import { storeUploadedFile, loadUploadedFile, deleteUploadedFile } from './storage';

// The API container has little memory (384 MB): one image at a time and no libvips cache
sharp.concurrency(1);
sharp.cache(false);

export const VARIANT_SIZES = [
    { key: 'thumb', width: 400 },
    { key: 'md', width: 1024 },
    { key: 'lg', width: 1920 },
] as const;

export interface ImageVariant { storageKey: string; url: string; width: number; height: number; sizeBytes: number }
export type ImageVariants = Partial<Record<typeof VARIANT_SIZES[number]['key'], ImageVariant>>;

const IMAGE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);

/**
 * Builds and stores the WebP variants of an uploaded photo. `publicUrl(id)` turns a stored file id into the
 * URL the browser uses. Returns null when the file is not an image of this brokerage or cannot be decoded.
 */
export async function createWebpVariants(storageKey: string, orgId: string, publicUrl: (id: string) => string):
    Promise<{ width: number; height: number; variants: ImageVariants } | null> {
    const original = await loadUploadedFile(storageKey);
    if (!original || original.orgId !== orgId || original.visibility !== 'PUBLIC' || !IMAGE_MIMES.has(original.mimeType.toLowerCase())) return null;
    const created: string[] = [];
    try {
        // rotate() applies the EXIF orientation of phone photos before resizing
        const meta = await sharp(original.buffer, { failOn: 'none' }).rotate().metadata();
        const baseName = original.filename.replace(/\.[^.]+$/, '') || 'foto';
        const variants: ImageVariants = {};
        for (const size of VARIANT_SIZES) {
            const { data, info } = await sharp(original.buffer, { failOn: 'none' })
                .rotate()
                .resize({ width: size.width, withoutEnlargement: true })
                .webp({ quality: 78, effort: 4 })
                .toBuffer({ resolveWithObject: true });
            const stored = await storeUploadedFile({
                orgId, visibility: 'PUBLIC', filename: `${baseName}-${size.key}.webp`, mimeType: 'image/webp', buffer: data,
            });
            created.push(stored.id);
            variants[size.key] = { storageKey: stored.id, url: publicUrl(stored.id), width: info.width, height: info.height, sizeBytes: data.byteLength };
        }
        const portrait = (meta.orientation ?? 1) >= 5;
        return { width: (portrait ? meta.height : meta.width) ?? 0, height: (portrait ? meta.width : meta.height) ?? 0, variants };
    } catch (err) {
        console.error('[images] could not create WebP variants:', err);
        for (const id of created) await deleteUploadedFile(id, orgId).catch(() => {});
        return null;
    }
}

/** Storage keys of the variants saved in MediaAsset.variants. */
export function variantKeys(variants: unknown): string[] {
    if (!variants || typeof variants !== 'object') return [];
    return Object.values(variants as Record<string, { storageKey?: unknown }>)
        .map(v => (v && typeof v.storageKey === 'string' ? v.storageKey : null))
        .filter((k): k is string => Boolean(k));
}
