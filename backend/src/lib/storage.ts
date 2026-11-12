import crypto from 'crypto';
import { prisma } from '../server';

export interface StoredFileMeta {
    id: string;
    orgId: string;
    visibility: 'PUBLIC' | 'PRIVATE';
    filename: string;
    mimeType: string;
    sizeBytes: number;
    r2Key: string | null;
}

export interface StoredFileResult extends StoredFileMeta {
    buffer: Buffer;
}

interface R2Config {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
}

function getR2Config(): R2Config | null {
    const accountId = process.env.R2_ACCOUNT_ID?.trim();
    const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
    const bucket = process.env.R2_BUCKET_NAME?.trim();
    if (accountId && accessKeyId && secretAccessKey && bucket) {
        return { accountId, accessKeyId, secretAccessKey, bucket };
    }
    return null;
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
    return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Buffer | string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Minimal AWS Signature V4 request helper for Cloudflare R2 S3-compatible API.
 */
async function r2Request(
    cfg: R2Config,
    method: 'PUT' | 'GET' | 'DELETE',
    objectKey: string,
    body?: Buffer,
    contentType?: string,
): Promise<Response> {
    const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
    const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
    const canonicalUri = `/${encodeURIComponent(cfg.bucket)}/${encodedKey}`;
    const url = `https://${host}${canonicalUri}`;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const region = 'auto';
    const service = 's3';

    const payloadHash = sha256Hex(body ?? '');
    const headers: Record<string, string> = {
        host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
    };
    if (contentType) {
        headers['content-type'] = contentType;
    }

    const sortedHeaderKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedHeaderKeys.map(k => `${k}:${headers[k]}\n`).join('');
    const signedHeaders = sortedHeaderKeys.join(';');

    const canonicalRequest = [
        method,
        canonicalUri,
        '',
        canonicalHeaders,
        signedHeaders,
        payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
    ].join('\n');

    const kDate = hmacSha256(`AWS4${cfg.secretAccessKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, region);
    const kService = hmacSha256(kRegion, service);
    const kSigning = hmacSha256(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

    headers['Authorization'] =
        `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return fetch(url, {
        method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
    });
}

function sanitizeFilename(name: string): string {
    const cleaned = name.replace(/[^\w.\- ()\u4e00-\u9fa5]/g, '_').trim();
    return cleaned.slice(0, 120) || 'file';
}

export async function storeUploadedFile(params: {
    orgId: string;
    visibility: 'PUBLIC' | 'PRIVATE';
    filename: string;
    mimeType: string;
    buffer: Buffer;
}): Promise<StoredFileMeta> {
    const safeFilename = sanitizeFilename(params.filename);
    const sizeBytes = params.buffer.byteLength;
    const r2 = getR2Config();
    const id = crypto.randomUUID();

    if (r2) {
        const r2Key = `${params.orgId}/${params.visibility.toLowerCase()}/${id}-${safeFilename}`;
        const res = await r2Request(r2, 'PUT', r2Key, params.buffer, params.mimeType);
        if (!res.ok) {
            throw new Error(`R2 upload failed with status ${res.status}`);
        }
        const record = await prisma.uploadedFile.create({
            data: {
                id,
                orgId: params.orgId,
                visibility: params.visibility,
                filename: safeFilename,
                mimeType: params.mimeType,
                sizeBytes,
                r2Key,
                data: null,
            },
        });
        return {
            id: record.id,
            orgId: record.orgId,
            visibility: record.visibility as 'PUBLIC' | 'PRIVATE',
            filename: record.filename,
            mimeType: record.mimeType,
            sizeBytes: record.sizeBytes,
            r2Key: record.r2Key,
        };
    }

    const record = await prisma.uploadedFile.create({
        data: {
            id,
            orgId: params.orgId,
            visibility: params.visibility,
            filename: safeFilename,
            mimeType: params.mimeType,
            sizeBytes,
            r2Key: null,
            // Prisma 6+ types Bytes as Uint8Array<ArrayBuffer>; copy so the type (and memory) is exact.
            data: new Uint8Array(params.buffer),
        },
    });

    return {
        id: record.id,
        orgId: record.orgId,
        visibility: record.visibility as 'PUBLIC' | 'PRIVATE',
        filename: record.filename,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        r2Key: null,
    };
}

export async function loadUploadedFile(id: string): Promise<StoredFileResult | null> {
    const record = await prisma.uploadedFile.findUnique({ where: { id } });
    if (!record) return null;

    if (record.r2Key) {
        const r2 = getR2Config();
        if (!r2) return null;
        const res = await r2Request(r2, 'GET', record.r2Key);
        if (!res.ok) return null;
        const arr = await res.arrayBuffer();
        return {
            id: record.id,
            orgId: record.orgId,
            visibility: record.visibility as 'PUBLIC' | 'PRIVATE',
            filename: record.filename,
            mimeType: record.mimeType,
            sizeBytes: record.sizeBytes,
            r2Key: record.r2Key,
            buffer: Buffer.from(arr),
        };
    }

    if (!record.data) return null;
    return {
        id: record.id,
        orgId: record.orgId,
        visibility: record.visibility as 'PUBLIC' | 'PRIVATE',
        filename: record.filename,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        r2Key: null,
        buffer: Buffer.from(record.data),
    };
}

export async function deleteUploadedFile(storageKey: string | null | undefined, orgId: string): Promise<void> {
    if (!storageKey) return;
    const record = await prisma.uploadedFile.findFirst({
        where: { id: storageKey, orgId },
        select: { id: true, r2Key: true },
    });
    if (!record) return;

    if (record.r2Key) {
        const r2 = getR2Config();
        if (r2) {
            try {
                await r2Request(r2, 'DELETE', record.r2Key);
            } catch {
                // Best-effort cleanup on object storage
            }
        }
    }

    await prisma.uploadedFile.delete({ where: { id: record.id } }).catch(() => {});
}

export function createSignedPrivateFileToken(fileId: string, orgId: string, ttlSeconds = 600): { exp: number; sig: string } {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const secret = process.env.JWT_SECRET!;
    const sig = crypto
        .createHmac('sha256', secret)
        .update(`private-file:${fileId}:${orgId}:${exp}`)
        .digest('hex');
    return { exp, sig };
}

export function verifySignedPrivateFileToken(fileId: string, orgId: string, expRaw: string | undefined, sigRaw: string | undefined): boolean {
    if (!expRaw || !sigRaw) return false;
    const exp = Number(expRaw);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
    const secret = process.env.JWT_SECRET!;
    const expected = crypto
        .createHmac('sha256', secret)
        .update(`private-file:${fileId}:${orgId}:${exp}`)
        .digest('hex');
    if (expected.length !== sigRaw.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(sigRaw, 'utf8'));
}
