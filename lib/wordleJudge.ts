/**
 * Browser-side runner for the wordle_judge circuit (steps 3+4).
 */
import {
    buildGameInputs,
    gridToEmoji,
    wordMatrixToInputs,
    u8ArrayToInputs,
    MAX_GUESSES,
} from "./wordle";
import {
    getDictionaryRoot,
    getProofsForWords,
    getWordProof,
} from "./dictionaryMerkle";
import { hashAnswerWord } from "./answerHash";
import { TREE_HEIGHT } from "./merkleCore";
import { proofBytesToHex } from "./slackFormat";

export interface WordleJudgeResult {
    answerWord: string;
    guessWords: string[];
    numGuesses: number;
    gridEmoji: string;
    dictionaryRoot: string;
    answerHash: string;
    proofHex: string;
    proofBytes: Uint8Array;
    publicInputs: string[];
    proveMs: number;
    verifyMs: number;
    verified: boolean;
    tamperedVerified: boolean;
}

interface CompiledCircuit {
    bytecode: string;
    abi: unknown;
}

const EMPTY_PATH = Array.from({ length: TREE_HEIGHT }, () => "0x0");

let cachedCircuit: Promise<CompiledCircuit> | null = null;
function loadCircuit(): Promise<CompiledCircuit> {
    if (!cachedCircuit) {
        cachedCircuit = fetch("/circuits/wordle_judge.json").then((r) => {
            if (!r.ok) {
                throw new Error(
                    `failed to load circuit: ${r.status}. ` +
                        `Run \`nargo compile --package wordle_judge\` then restart dev server.`,
                );
            }
            return r.json() as Promise<CompiledCircuit>;
        });
    }
    return cachedCircuit;
}

export async function proveWordleJudge(
    answerWord: string,
    guessWords: string[],
    onPhase: (phase: string) => void = () => {},
): Promise<WordleJudgeResult> {
    onPhase("Building inputs…");
    const { answer, guesses, grid, numGuesses } = buildGameInputs(
        answerWord,
        guessWords,
    );

    onPhase("Loading dictionary proofs…");
    const dictionaryRoot = await getDictionaryRoot();
    const answerHashHex = await hashAnswerWord(answerWord);
    const answerHashDecimal = BigInt(answerHashHex).toString();
    const answerProof = await getWordProof(answerWord);
    const guessProofs = await getProofsForWords(guessWords);

    const guessIndices: string[] = [];
    const guessPaths: string[][] = [];
    for (let i = 0; i < MAX_GUESSES; i++) {
        if (i < numGuesses) {
            guessIndices.push(guessProofs[i].index);
            guessPaths.push(guessProofs[i].path);
        } else {
            guessIndices.push("0");
            guessPaths.push(EMPTY_PATH);
        }
    }

    onPhase("Loading circuit…");
    const circuit = await loadCircuit();

    onPhase("Starting prover…");
    const [{ Noir }, bbjs] = await Promise.all([
        import("@noir-lang/noir_js"),
        import("@aztec/bb.js"),
    ]);
    const { Barretenberg, UltraHonkBackend } = bbjs;

    onPhase("Generating witness…");
    const noir = new Noir(circuit as never);
    const inputs = {
        guesses: wordMatrixToInputs(guesses),
        answer: u8ArrayToInputs(answer),
        num_guesses: numGuesses.toString(),
        grid: wordMatrixToInputs(grid),
        dictionary_root: dictionaryRoot,
        answer_hash: answerHashDecimal,
        answer_index: answerProof.index,
        answer_path: answerProof.path,
        guess_indices: guessIndices,
        guess_paths: guessPaths,
    };
    const { witness } = await noir.execute(inputs);

    onPhase("Generating proof… (this may take a minute)");
    const bb = await Barretenberg.new();
    const backend = new UltraHonkBackend(circuit.bytecode, bb);
    const t0 = performance.now();
    const proof = await backend.generateProof(witness);
    const proveMs = performance.now() - t0;

    onPhase("Verifying proof…");
    const t1 = performance.now();
    const verified = await backend.verifyProof(proof);
    const verifyMs = performance.now() - t1;

    await bb.destroy();

    return {
        answerWord,
        guessWords,
        numGuesses,
        gridEmoji: gridToEmoji(grid.slice(0, numGuesses)),
        dictionaryRoot,
        answerHash: answerHashHex,
        proofHex: proofBytesToHex(proof.proof),
        proofBytes: proof.proof,
        publicInputs: proof.publicInputs,
        proveMs,
        verifyMs,
        verified,
        tamperedVerified: false,
    };
}

/** Live preview without proving. */
export function previewGrid(answerWord: string, guessWords: string[]): string {
    const { grid, numGuesses } = buildGameInputs(answerWord, guessWords);
    return gridToEmoji(grid.slice(0, numGuesses));
}
