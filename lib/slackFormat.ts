import { proofExpiresAt } from "./proofTtl";

/** Slack posts are limited to ~40k chars; UltraHonk proofs are ~15–30k+ bytes. */
export const SLACK_SAFE_CHAR_LIMIT = 40_000;

export interface SlackPasteInput {
    numGuesses: number;
    maxGuesses?: number;
    gridEmoji: string;
    answerHash: string;
    proofUrl?: string;
    /** Defaults to today (local timezone). Embedded in the header line. */
    date?: Date;
}

/** YYYY-MM-DD in local timezone. */
export function formatSlackDate(date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

/** Human-facing Slack message: grid + answer_hash + proof URL. */
export function formatSlackPaste(input: SlackPasteInput): string {
    const max = input.maxGuesses ?? 6;
    const score = `${input.numGuesses}/${max}`;
    const date = formatSlackDate(input.date);
    const header = `[Wordle ${score} ${date}]`;

    return [
        header,
        "",
        input.gridEmoji,
        "",
        "-PROOF-",
        `answer_hash: ${input.answerHash}`,
        input.proofUrl
            ? `proof: ${input.proofUrl}`
            : "proof: (publish from the web app first)",
    ].join("\n");
}

/** Machine-readable bundle for verification (download / hosted URL). */
export interface ProofBundle {
    version: 1;
    circuit: "wordle_judge";
    answer_hash: string;
    dictionary_root: string;
    public_inputs: string[];
    proof_b64: string;
    /** ISO 8601 — proof URLs stop working after this time. */
    expires_at?: string;
}

export interface ProofBundleInput {
    answerHash: string;
    dictionaryRoot: string;
    publicInputs: string[];
    proofBytes: Uint8Array;
}

export function buildProofBundle(input: ProofBundleInput): ProofBundle {
    return {
        version: 1,
        circuit: "wordle_judge",
        answer_hash: input.answerHash,
        dictionary_root: input.dictionaryRoot,
        public_inputs: input.publicInputs,
        proof_b64: bytesToBase64(input.proofBytes),
        expires_at: proofExpiresAt(),
    };
}

export function proofBundleJson(bundle: ProofBundle): string {
    return JSON.stringify(bundle, null, 2);
}

export function downloadProofBundle(bundle: ProofBundle, filename: string): void {
    const blob = new Blob([proofBundleJson(bundle)], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export async function copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
}

export function truncateHex(value: string, head = 14, tail = 8): string {
    if (value.length <= head + tail + 1) return value;
    return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function bytesToHex(bytes: Uint8Array): string {
    return (
        "0x" +
        Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
    );
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function proofBytesToHex(proof: Uint8Array): string {
    return bytesToHex(proof);
}

export function base64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/** Normalize Noir/bb field hex for comparison (lowercase, 0x prefix). */
export function normalizeFieldHex(value: string): string {
    const trimmed = value.trim();
    const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
        throw new Error(`invalid field hex: ${value}`);
    }
    return "0x" + BigInt("0x" + hex).toString(16).padStart(64, "0");
}

export interface ParsedSlackPaste {
    date: string;
    numGuesses: number;
    maxGuesses: number;
    gridEmoji: string;
    gridLines: string[];
    answerHash: string;
    proofUrl?: string;
}

const SLACK_HEADER =
    /^\[Wordle\s+(\d+)\s*\/\s*(\d+)\s+(\d{4}-\d{2}-\d{2})\s*\]$/i;
const GRID_LINE = /^[⬛🟨🟩]+$/u;
const ANSWER_HASH = /answer_hash:\s*(0x[0-9a-fA-F]+)/i;
const PROOF_URL = /^proof:\s*(\S+)/i;
const PROOF_MARKER = "-PROOF-";

function matchSlackHeader(line: string): {
    numGuesses: number;
    maxGuesses: number;
    date: string;
} | null {
    const match = line.trim().match(SLACK_HEADER);
    if (!match) return null;
    return {
        numGuesses: Number(match[1]),
        maxGuesses: Number(match[2]),
        date: match[3],
    };
}

/** Parse a Slack paste: [Wordle N/M YYYY-MM-DD] … -PROOF- … */
export function parseSlackPaste(text: string): ParsedSlackPaste {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const headerIdx = lines.findIndex((l) => matchSlackHeader(l) !== null);
    if (headerIdx === -1) {
        throw new Error(
            'could not find "[Wordle N/M YYYY-MM-DD]" header line',
        );
    }

    const header = matchSlackHeader(lines[headerIdx]);
    if (!header) {
        throw new Error("invalid Wordle header");
    }

    const { numGuesses, maxGuesses, date } = header;

    const gridLines: string[] = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === "") continue;
        if (line === PROOF_MARKER) break;
        if (GRID_LINE.test(line)) {
            gridLines.push(line);
            continue;
        }
        if (line.startsWith("answer_hash:") || line.startsWith("proof:")) {
            break;
        }
        throw new Error(`unexpected line in grid section: ${line}`);
    }

    if (gridLines.length === 0) {
        throw new Error("no emoji grid lines found");
    }

    const proofMarkerIdx = lines.findIndex(
        (l) => l.trim() === PROOF_MARKER,
    );
    if (proofMarkerIdx === -1) {
        throw new Error('could not find "-PROOF-" marker');
    }

    const hashLine = lines
        .slice(proofMarkerIdx + 1)
        .find((l) => ANSWER_HASH.test(l));
    if (!hashLine) {
        throw new Error('could not find "answer_hash: 0x..." line');
    }
    const hashMatch = hashLine.match(ANSWER_HASH);
    if (!hashMatch) {
        throw new Error("invalid answer_hash line");
    }

    if (gridLines.length !== numGuesses) {
        throw new Error(
            `grid has ${gridLines.length} rows but header says ${numGuesses}/${maxGuesses}`,
        );
    }

    const proofLine = lines
        .slice(proofMarkerIdx + 1)
        .find((l) => PROOF_URL.test(l.trim()));
    const proofMatch = proofLine?.trim().match(PROOF_URL);
    const proofUrl = proofMatch?.[1];

    return {
        date,
        numGuesses,
        maxGuesses,
        gridEmoji: gridLines.join("\n"),
        gridLines,
        answerHash: normalizeFieldHex(hashMatch[1]),
        proofUrl,
    };
}

export function parseProofBundleJson(json: string): ProofBundle {
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        throw new Error("invalid JSON");
    }

    if (typeof raw !== "object" || raw === null) {
        throw new Error("proof bundle must be a JSON object");
    }

    const b = raw as Record<string, unknown>;
    if (b.version !== 1) {
        throw new Error(`unsupported bundle version: ${String(b.version)}`);
    }
    if (b.circuit !== "wordle_judge") {
        throw new Error(`unsupported circuit: ${String(b.circuit)}`);
    }
    if (typeof b.answer_hash !== "string") {
        throw new Error("missing answer_hash");
    }
    if (typeof b.dictionary_root !== "string") {
        throw new Error("missing dictionary_root");
    }
    if (!Array.isArray(b.public_inputs) || b.public_inputs.length === 0) {
        throw new Error("missing public_inputs array");
    }
    if (typeof b.proof_b64 !== "string" || b.proof_b64.length === 0) {
        throw new Error("missing proof_b64");
    }

    if (b.expires_at !== undefined && typeof b.expires_at !== "string") {
        throw new Error("invalid expires_at");
    }

    if (!b.public_inputs.every((pi) => typeof pi === "string")) {
        throw new Error("public_inputs must be strings");
    }

    return {
        version: 1,
        circuit: "wordle_judge",
        answer_hash: normalizeFieldHex(b.answer_hash),
        dictionary_root: normalizeFieldHex(b.dictionary_root),
        public_inputs: b.public_inputs as string[],
        proof_b64: b.proof_b64,
        expires_at:
            typeof b.expires_at === "string" ? b.expires_at : undefined,
    };
}
