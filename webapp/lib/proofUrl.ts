import { createHash } from "crypto";
import type { ProofBundle } from "./slackFormat";

const PROOF_ID = /^[0-9a-f]{16}$/;

/** Content-addressed id (stable URL for identical proofs). */
export function proofBundleId(bundle: ProofBundle): string {
    const canonical = JSON.stringify({
        version: bundle.version,
        circuit: bundle.circuit,
        answer_hash: bundle.answer_hash,
        dictionary_root: bundle.dictionary_root,
        public_inputs: bundle.public_inputs,
        proof_b64: bundle.proof_b64,
    });
    return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function isValidProofId(id: string): boolean {
    return PROOF_ID.test(id.replace(/\.json$/, ""));
}

export function normalizeProofId(id: string): string {
    const clean = id.trim().replace(/\.json$/, "");
    if (!isValidProofId(clean)) {
        throw new Error(`invalid proof id: ${id}`);
    }
    return clean;
}

export function buildProofUrl(id: string, origin: string): string {
    const clean = normalizeProofId(id);
    return `${origin.replace(/\/$/, "")}/proof/${clean}.json`;
}

/** Resolve pasted URL, path, or bare id to a fetchable proof URL. */
export function resolveProofUrl(input: string, origin: string): string {
    const trimmed = input.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        return trimmed;
    }
    if (trimmed.startsWith("/proof/")) {
        return `${origin.replace(/\/$/, "")}${trimmed}`;
    }
    return buildProofUrl(trimmed, origin);
}

export async function publishProofBundle(
    bundle: ProofBundle,
): Promise<{ id: string; url: string }> {
    const res = await fetch("/api/proofs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bundle),
    });
    if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
            error?: string;
        } | null;
        throw new Error(body?.error ?? `publish failed (${res.status})`);
    }
    return res.json() as Promise<{ id: string; url: string }>;
}

export async function fetchProofJsonFromUrl(
    input: string,
): Promise<{ url: string; json: string }> {
    const origin =
        typeof window !== "undefined" ? window.location.origin : "";
    const url = resolveProofUrl(input, origin);
    const res = await fetch(url);
    if (res.status === 410) {
        throw new Error("Proof expired — ask the poster to re-prove");
    }
    if (!res.ok) {
        throw new Error(`Failed to fetch proof (${res.status})`);
    }
    const json = await res.text();
    return { url, json };
}
