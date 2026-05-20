/** a=0 .. z=25 letter encoding shared with the Noir circuits. */

export const MAX_GUESSES = 6;
export const WORD_LEN = 5;

export type Grid = number[]; // length 5, values 0|1|2
export type Word = number[]; // length 5, values 0..25

const GRID_EMOJI = ["⬛", "🟨", "🟩"] as const;

export function encodeWord(word: string): Word {
    const w = word.trim().toLowerCase();
    if (w.length !== WORD_LEN) {
        throw new Error(`word must be exactly ${WORD_LEN} letters: "${word}"`);
    }
    return [...w].map((c) => {
        const code = c.charCodeAt(0) - "a".charCodeAt(0);
        if (code < 0 || code > 25) throw new Error(`invalid letter: ${c}`);
        return code;
    });
}

export function decodeWord(word: Word): string {
    return word.map((n) => String.fromCharCode("a".charCodeAt(0) + n)).join("");
}

/** JS port of `circuits/wordle_judge` judge() — useful for live grid preview. */
export function judge(guess: Word, answer: Word): Grid {
    const result: Grid = [0, 0, 0, 0, 0];
    const answerUsed = [false, false, false, false, false];

    for (let i = 0; i < WORD_LEN; i++) {
        if (guess[i] === answer[i]) {
            result[i] = 2;
            answerUsed[i] = true;
        }
    }

    for (let i = 0; i < WORD_LEN; i++) {
        if (result[i] !== 2) {
            let matched = false;
            for (let j = 0; j < WORD_LEN; j++) {
                if (!matched && !answerUsed[j] && guess[i] === answer[j]) {
                    result[i] = 1;
                    answerUsed[j] = true;
                    matched = true;
                }
            }
        }
    }

    return result;
}

export function gridRowToEmoji(row: Grid): string {
    return row.map((c) => GRID_EMOJI[c] ?? "?").join("");
}

export function gridToEmoji(grid: Grid[]): string {
    return grid.map(gridRowToEmoji).join("\n");
}

const EMOJI_TO_CELL: Record<string, number> = {
    "⬛": 0,
    "🟨": 1,
    "🟩": 2,
};

export function emojiRowToGrid(line: string): Grid {
    const chars = [...line.trim()];
    if (chars.length !== WORD_LEN) {
        throw new Error(`grid row must be ${WORD_LEN} emoji, got ${chars.length}`);
    }
    return chars.map((ch) => {
        const cell = EMOJI_TO_CELL[ch];
        if (cell === undefined) {
            throw new Error(`invalid grid emoji: ${ch}`);
        }
        return cell;
    });
}

export function emojiRowsToGrid(lines: string[]): Grid[] {
    return lines.map(emojiRowToGrid);
}

/** Decode wordle_judge public inputs (33 fields). */
export function decodePublicInputs(publicInputs: string[]): {
    numGuesses: number;
    grid: Grid[];
    dictionaryRoot: string;
    answerHash: string;
} {
    const expected = 1 + MAX_GUESSES * WORD_LEN + 2;
    if (publicInputs.length !== expected) {
        throw new Error(
            `expected ${expected} public inputs, got ${publicInputs.length}`,
        );
    }

    const numGuesses = Number(BigInt(publicInputs[0]));
    const grid: Grid[] = [];
    let idx = 1;
    for (let r = 0; r < MAX_GUESSES; r++) {
        const row: Grid = [];
        for (let c = 0; c < WORD_LEN; c++) {
            row.push(Number(BigInt(publicInputs[idx++])));
        }
        grid.push(row);
    }

    return {
        numGuesses,
        grid,
        dictionaryRoot: publicInputs[idx++],
        answerHash: publicInputs[idx++],
    };
}

export function gridsMatch(a: Grid[], b: Grid[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].length !== b[i].length) return false;
        for (let j = 0; j < a[i].length; j++) {
            if (a[i][j] !== b[i][j]) return false;
        }
    }
    return true;
}

/** Noir/noir_js expects numeric fields as decimal strings. */
export function u8ArrayToInputs(arr: number[]): string[] {
    return arr.map((n) => n.toString());
}

export function wordMatrixToInputs(rows: Word[]): string[][] {
    return rows.map(u8ArrayToInputs);
}

/** Preset: SLATE (all gray) then CRANE (win). */
export const DEMO = {
    answer: "crane",
    guesses: ["slate", "crane"],
} as const;

/** Returns an error when guesses break Wordle rules (e.g. extra rows after winning). */
export function validateGuessWords(
    answerWord: string,
    guessWords: string[],
): string | null {
    if (guessWords.length < 1) {
        return "Enter at least one guess.";
    }
    if (guessWords.length > MAX_GUESSES) {
        return `At most ${MAX_GUESSES} guesses allowed.`;
    }

    const answer = answerWord.trim().toLowerCase();
    const winIndex = guessWords.findIndex(
        (guess) => guess.trim().toLowerCase() === answer,
    );

    if (winIndex >= 0 && winIndex < guessWords.length - 1) {
        return `Guesses after the winning word (row ${winIndex + 1}) are not allowed.`;
    }

    const last = guessWords[guessWords.length - 1].trim().toLowerCase();
    if (last !== answer) {
        return "The final guess must match the answer.";
    }

    return null;
}

export function buildGameInputs(answerWord: string, guessWords: string[]) {
    const validationError = validateGuessWords(answerWord, guessWords);
    if (validationError) {
        throw new Error(validationError);
    }

    const answer = encodeWord(answerWord);
    const numGuesses = guessWords.length;
    const guesses: Word[] = [];
    const grid: Grid[] = [];

    for (let i = 0; i < MAX_GUESSES; i++) {
        if (i < numGuesses) {
            const g = encodeWord(guessWords[i]);
            guesses.push(g);
            grid.push(judge(g, answer));
        } else {
            guesses.push([0, 0, 0, 0, 0]);
            grid.push([0, 0, 0, 0, 0]);
        }
    }

    return { answer, guesses, grid, numGuesses };
}
