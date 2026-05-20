/**
 * Extract Wordle guess words from an in-game screenshot (letters visible).
 * Emoji-only share images are not supported.
 */
import { MAX_GUESSES } from "./wordle";
import {
    findGridBounds,
    loadImageToCanvas,
    renderRowForOcr,
    renderTileForOcr,
    type GridBounds,
    type RowBand,
} from "./wordleScreenshotGrid";

let dictionaryWords: Promise<Set<string>> | null = null;

async function getDictionaryWords(): Promise<Set<string>> {
    if (!dictionaryWords) {
        dictionaryWords = fetch("/dictionary/words.json")
            .then((r) => {
                if (!r.ok) throw new Error("missing dictionary/words.json");
                return r.json() as Promise<{ words: string[] }>;
            })
            .then((data) => new Set(data.words));
    }
    return dictionaryWords;
}

/** Pull a single 5-letter word from an OCR line, if present. */
export function fiveLetterWordFromLine(line: string): string | null {
    const trimmed = line.trim();
    const exact = trimmed.match(/^[A-Za-z]{5}$/);
    if (exact) return exact[0].toLowerCase();

    const compact = trimmed.replace(/[^A-Za-z]/g, "");
    if (compact.length === 5 && /^[A-Za-z]+$/.test(compact)) {
        return compact.toLowerCase();
    }

    const match = trimmed.match(/\b[A-Za-z]{5}\b/);
    return match ? match[0].toLowerCase() : null;
}

export function closestDictionaryWord(
    raw: string,
    dict: Set<string>,
): string | null {
    const word = raw.toLowerCase();
    if (dict.has(word)) return word;
    if (word.length !== 5) return null;

    for (const candidate of dict) {
        if (candidate.length !== 5) continue;
        let diff = 0;
        for (let i = 0; i < 5; i++) {
            if (candidate[i] !== word[i]) diff++;
            if (diff > 1) break;
        }
        if (diff <= 1) return candidate;
    }
    return null;
}

/** Fill unknown letters using the Wordle dictionary, e.g. "e?ght" -> "eight". */
export function resolvePatternWord(
    pattern: string,
    dict: Set<string>,
): string | null {
    if (pattern.length !== 5) return null;
    const normalized = pattern.toLowerCase();
    const matches: string[] = [];

    for (const candidate of dict) {
        if (candidate.length !== 5) continue;
        let ok = true;
        for (let i = 0; i < 5; i++) {
            if (normalized[i] !== "?" && normalized[i] !== candidate[i]) {
                ok = false;
                break;
            }
        }
        if (ok) matches.push(candidate);
    }

    if (matches.length === 1) return matches[0];
    return null;
}

interface OcrLine {
    text: string;
    y: number;
}

interface OcrPageData {
    blocks?: Array<{
        paragraphs: Array<{
            lines: Array<{ text: string; bbox: { y0: number } }>;
        }>;
    }> | null;
    text: string;
}

function linesFromOcrData(data: OcrPageData): OcrLine[] {
    const lines: OcrLine[] = [];
    if (data.blocks) {
        for (const block of data.blocks) {
            for (const paragraph of block.paragraphs) {
                for (const line of paragraph.lines) {
                    lines.push({ text: line.text, y: line.bbox.y0 });
                }
            }
        }
    }
    if (lines.length > 0) {
        return lines.sort((a, b) => a.y - b.y);
    }
    return data.text
        .split("\n")
        .map((text, index) => ({ text, y: index }));
}

/** Same-origin paths so OCR works under COOP/COEP (required by bb.js). */
const TESSERACT_OPTIONS = {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract-core",
    langPath: "/tesseract-lang",
    workerBlobURL: false,
    gzip: true,
} as const;

const ROW_OCR_PSMS = ["7", "8"] as const;
const TILE_OCR_PSMS = ["10", "8"] as const;

type OcrWorker = {
    setParameters: (params: Record<string, string>) => Promise<unknown>;
    recognize: (
        image: HTMLCanvasElement | File,
    ) => Promise<{ data: { text: string } }>;
    terminate: () => Promise<unknown>;
};

async function createOcrWorker(
    onProgress: (message: string) => void,
): Promise<OcrWorker> {
    const { createWorker } = await import("tesseract.js");
    return createWorker("eng", undefined, {
        ...TESSERACT_OPTIONS,
        logger: (event) => {
            if (event.status === "recognizing text") {
                onProgress(
                    `Reading screenshot… ${Math.round(event.progress * 100)}%`,
                );
            }
        },
    });
}

function lettersFromOcr(text: string): string {
    return text.replace(/[^A-Za-z]/g, "").toUpperCase();
}

async function ocrCanvasRow(worker: OcrWorker, canvas: HTMLCanvasElement): Promise<string | null> {
    for (const psm of ROW_OCR_PSMS) {
        await worker.setParameters({
            tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
            tessedit_pageseg_mode: psm,
        });
        const { data } = await worker.recognize(canvas);
        const letters = lettersFromOcr(data.text);
        if (letters.length >= 5) return letters.slice(0, 5).toLowerCase();
    }
    return null;
}

async function ocrCanvasTile(
    worker: OcrWorker,
    canvas: HTMLCanvasElement,
): Promise<string | null> {
    for (const psm of TILE_OCR_PSMS) {
        await worker.setParameters({
            tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
            tessedit_pageseg_mode: psm,
        });
        const { data } = await worker.recognize(canvas);
        const letters = lettersFromOcr(data.text);
        if (letters.length > 0) return letters[0];
    }
    return null;
}

function resolveWordCandidate(raw: string, dict: Set<string>): string | null {
    if (raw.includes("?")) return resolvePatternWord(raw, dict);
    return closestDictionaryWord(raw, dict);
}

async function readRowByTiles(
    worker: OcrWorker,
    source: HTMLCanvasElement,
    bounds: GridBounds,
    row: RowBand,
    dict: Set<string>,
): Promise<string | null> {
    const letters: string[] = [];
    for (let tile = 0; tile < 5; tile++) {
        const tileCanvas = renderTileForOcr(source, bounds, row, tile);
        if (!tileCanvas) {
            letters.push("?");
            continue;
        }
        const letter = await ocrCanvasTile(worker, tileCanvas);
        letters.push(letter ?? "?");
    }

    const joined = letters.join("").toLowerCase();
    if (!joined.includes("?")) {
        return resolveWordCandidate(joined, dict);
    }
    return resolvePatternWord(joined, dict);
}

async function readRowWord(
    worker: OcrWorker,
    source: HTMLCanvasElement,
    bounds: GridBounds,
    row: RowBand,
    dict: Set<string>,
): Promise<string | null> {
    const rowCanvas = renderRowForOcr(source, bounds, row);
    if (rowCanvas) {
        const rowWord = await ocrCanvasRow(worker, rowCanvas);
        if (rowWord) {
            const matched = resolveWordCandidate(rowWord, dict);
            if (matched) return matched;
        }
    }

    const tileWord = await readRowByTiles(worker, source, bounds, row, dict);
    if (tileWord) return tileWord;

    return null;
}

async function extractFromGrid(
    worker: OcrWorker,
    source: HTMLCanvasElement,
    onProgress: (message: string) => void,
): Promise<string[] | null> {
    const ctx = source.getContext("2d");
    if (!ctx) return null;

    const bounds = findGridBounds(
        ctx.getImageData(0, 0, source.width, source.height).data,
        source.width,
        source.height,
    );
    if (!bounds || bounds.rows.length === 0) return null;

    const dict = await getDictionaryWords();
    const guesses: string[] = [];

    for (let i = 0; i < bounds.rows.length && i < MAX_GUESSES; i++) {
        onProgress(`Reading row ${i + 1}/${bounds.rows.length}…`);
        const word = await readRowWord(worker, source, bounds, bounds.rows[i], dict);
        guesses.push(word ?? "");
    }

    return guesses.some((word) => word.length > 0) ? guesses : null;
}

async function extractFromFullImage(
    worker: OcrWorker,
    file: File,
): Promise<string[]> {
    const { data } = await worker.recognize(file);
    const dict = await getDictionaryWords();
    const guesses: string[] = [];

    for (const line of linesFromOcrData(data)) {
        const word = fiveLetterWordFromLine(line.text);
        if (!word) continue;
        const matched = closestDictionaryWord(word, dict);
        if (!matched) continue;
        if (guesses.length > 0 && guesses[guesses.length - 1] === matched) {
            continue;
        }
        guesses.push(matched);
        if (guesses.length >= MAX_GUESSES) break;
    }

    return guesses;
}

export async function extractGuessesFromScreenshot(
    file: File,
    onProgress: (message: string) => void = () => {},
): Promise<string[]> {
    onProgress("Loading OCR engine…");
    const worker = await createOcrWorker(onProgress);

    try {
        onProgress("Detecting Wordle grid…");
        const source = await loadImageToCanvas(file);
        let guesses = await extractFromGrid(worker, source, onProgress);

        if (!guesses) {
            onProgress("Grid not found — trying full-image OCR…");
            guesses = await extractFromFullImage(worker, file);
        }

        if (guesses.length === 0) {
            throw new Error(
                "No guess words found. Use a screenshot that shows letter tiles (not an emoji-only share).",
            );
        }

        return guesses;
    } finally {
        await worker.terminate();
    }
}
