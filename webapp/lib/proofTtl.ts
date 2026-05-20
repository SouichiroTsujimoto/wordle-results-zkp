/** Proof retention (default 7 days — matches Wordle daily cadence). */

export const DEFAULT_PROOF_TTL_DAYS = 7;

export function proofTtlDays(): number {
    const raw =
        process.env.PROOF_TTL_DAYS ??
        process.env.NEXT_PUBLIC_PROOF_TTL_DAYS;
    if (raw === undefined || raw === "") {
        return DEFAULT_PROOF_TTL_DAYS;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) {
        return DEFAULT_PROOF_TTL_DAYS;
    }
    return Math.floor(n);
}

export function proofTtlMs(): number {
    return proofTtlDays() * 24 * 60 * 60 * 1000;
}

export function proofExpiresAt(from = new Date()): string {
    const expires = new Date(from.getTime() + proofTtlMs());
    return expires.toISOString();
}

export function isExpiredIso(iso: string): boolean {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return false;
    return Date.now() > t;
}

export function isExpiredByAge(uploadedAt: Date): boolean {
    return Date.now() - uploadedAt.getTime() > proofTtlMs();
}

export function proofExpiryLabel(): string {
    const days = proofTtlDays();
    return days === 1 ? "1 day" : `${days} days`;
}
