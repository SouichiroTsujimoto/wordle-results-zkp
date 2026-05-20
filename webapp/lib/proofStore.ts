import fs from "fs/promises";
import path from "path";
import type { ProofBundle } from "./slackFormat";
import { normalizeProofId } from "./proofUrl";
import { isExpiredByAge, isExpiredIso } from "./proofTtl";

const STORE_DIR =
    process.env.PROOF_STORE_DIR ?? path.join(process.cwd(), ".proof-store");

export type ProofLoadResult =
    | { status: "found"; bundle: ProofBundle }
    | { status: "not_found" }
    | { status: "expired" };

function blobStoreEnabled(): boolean {
    return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function blobPath(id: string): string {
    return `proofs/${normalizeProofId(id)}.json`;
}

function bundleJson(bundle: ProofBundle): string {
    return JSON.stringify(bundle, null, 2);
}

function bundleIsExpired(
    bundle: ProofBundle,
    uploadedAt?: Date,
): boolean {
    if (bundle.expires_at && isExpiredIso(bundle.expires_at)) {
        return true;
    }
    if (uploadedAt && isExpiredByAge(uploadedAt)) {
        return true;
    }
    return false;
}

async function saveToFilesystem(
    id: string,
    bundle: ProofBundle,
): Promise<string> {
    await fs.mkdir(STORE_DIR, { recursive: true });
    const filePath = path.join(STORE_DIR, `${normalizeProofId(id)}.json`);
    try {
        await fs.access(filePath);
        return normalizeProofId(id);
    } catch {
        await fs.writeFile(filePath, bundleJson(bundle), "utf8");
        return normalizeProofId(id);
    }
}

async function loadRawFromFilesystem(
    id: string,
): Promise<{ bundle: ProofBundle; uploadedAt: Date } | null> {
    try {
        const filePath = path.join(STORE_DIR, `${normalizeProofId(id)}.json`);
        const [raw, stat] = await Promise.all([
            fs.readFile(filePath, "utf8"),
            fs.stat(filePath),
        ]);
        return {
            bundle: JSON.parse(raw) as ProofBundle,
            uploadedAt: stat.mtime,
        };
    } catch {
        return null;
    }
}

async function deleteFromFilesystem(id: string): Promise<boolean> {
    try {
        await fs.unlink(
            path.join(STORE_DIR, `${normalizeProofId(id)}.json`),
        );
        return true;
    } catch {
        return false;
    }
}

async function saveToBlob(id: string, bundle: ProofBundle): Promise<string> {
    const { get, put } = await import("@vercel/blob");
    const pathname = blobPath(id);
    const existing = await get(pathname, { access: "public" });
    if (existing?.statusCode === 200) {
        return normalizeProofId(id);
    }

    await put(pathname, bundleJson(bundle), {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: false,
    });
    return normalizeProofId(id);
}

async function loadRawFromBlob(
    id: string,
): Promise<{ bundle: ProofBundle; uploadedAt: Date } | null> {
    const { get } = await import("@vercel/blob");
    const result = await get(blobPath(id), { access: "public" });
    if (result?.statusCode !== 200 || !result.stream) {
        return null;
    }
    const raw = await new Response(result.stream).text();
    const uploadedAt = new Date(result.blob.uploadedAt);
    return {
        bundle: JSON.parse(raw) as ProofBundle,
        uploadedAt,
    };
}

async function deleteFromBlob(id: string): Promise<boolean> {
    const { del, get } = await import("@vercel/blob");
    const result = await get(blobPath(id), { access: "public" });
    if (result?.statusCode !== 200) {
        return false;
    }
    await del(result.blob.url);
    return true;
}

export async function saveProofBundle(
    id: string,
    bundle: ProofBundle,
): Promise<string> {
    if (blobStoreEnabled()) {
        return saveToBlob(id, bundle);
    }
    return saveToFilesystem(id, bundle);
}

export async function deleteProofBundle(id: string): Promise<boolean> {
    if (blobStoreEnabled()) {
        return deleteFromBlob(id);
    }
    return deleteFromFilesystem(id);
}

export async function loadProofBundleResult(
    id: string,
): Promise<ProofLoadResult> {
    const raw = blobStoreEnabled()
        ? await loadRawFromBlob(id)
        : await loadRawFromFilesystem(id);

    if (!raw) {
        return { status: "not_found" };
    }

    if (bundleIsExpired(raw.bundle, raw.uploadedAt)) {
        await deleteProofBundle(id);
        return { status: "expired" };
    }

    return { status: "found", bundle: raw.bundle };
}

/** @deprecated use loadProofBundleResult */
export async function loadProofBundle(
    id: string,
): Promise<ProofBundle | null> {
    const result = await loadProofBundleResult(id);
    return result.status === "found" ? result.bundle : null;
}

export async function purgeExpiredProofs(): Promise<{
    scanned: number;
    deleted: number;
}> {
    if (blobStoreEnabled()) {
        return purgeExpiredFromBlob();
    }
    return purgeExpiredFromFilesystem();
}

async function purgeExpiredFromBlob(): Promise<{
    scanned: number;
    deleted: number;
}> {
    const { del, list } = await import("@vercel/blob");
    let scanned = 0;
    let deleted = 0;
    let cursor: string | undefined;

    do {
        const page = await list({
            prefix: "proofs/",
            cursor,
            limit: 1000,
        });
        cursor = page.hasMore ? page.cursor : undefined;

        for (const blob of page.blobs) {
            scanned++;
            const uploadedAt = new Date(blob.uploadedAt);
            if (!isExpiredByAge(uploadedAt)) {
                continue;
            }
            await del(blob.url);
            deleted++;
        }
    } while (cursor);

    return { scanned, deleted };
}

async function purgeExpiredFromFilesystem(): Promise<{
    scanned: number;
    deleted: number;
}> {
    let scanned = 0;
    let deleted = 0;

    try {
        const files = await fs.readdir(STORE_DIR);
        for (const file of files) {
            if (!file.endsWith(".json")) continue;
            scanned++;
            const filePath = path.join(STORE_DIR, file);
            const stat = await fs.stat(filePath);
            if (isExpiredByAge(stat.mtime)) {
                await fs.unlink(filePath);
                deleted++;
            }
        }
    } catch {
        // store does not exist yet
    }

    return { scanned, deleted };
}

export function proofStoreBackend(): "blob" | "filesystem" {
    return blobStoreEnabled() ? "blob" : "filesystem";
}
