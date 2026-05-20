/**
 * Verify a Slack paste + wordle-proof.json bundle in the browser.
 */
import { hashAnswerWord } from "./answerHash";
import { getDictionaryRoot } from "./dictionaryMerkle";
import {
    decodePublicInputs,
    emojiRowsToGrid,
    gridToEmoji,
    gridsMatch,
    MAX_GUESSES,
} from "./wordle";
import {
    base64ToBytes,
    normalizeFieldHex,
    parseProofBundleJson,
    parseSlackPaste,
    type ParsedSlackPaste,
    type ProofBundle,
} from "./slackFormat";
import { isExpiredIso } from "./proofTtl";

export interface VerifyCheck {
    label: string;
    passed: boolean;
    detail?: string;
}

export interface WordleVerifyResult {
    slack: ParsedSlackPaste;
    bundle: ProofBundle;
    gridFromProof: string;
    checks: VerifyCheck[];
    verifyMs: number;
    allPassed: boolean;
}

interface CompiledCircuit {
    bytecode: string;
    abi: unknown;
}

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

export async function verifyWordleSubmission(
    slackText: string,
    proofJson: string,
    answerWord: string,
    onPhase: (phase: string) => void = () => {},
): Promise<WordleVerifyResult> {
    onPhase("Parsing Slack message…");
    const slack = parseSlackPaste(slackText);

    onPhase("Parsing proof file…");
    const bundle = parseProofBundleJson(proofJson);
    if (bundle.expires_at && isExpiredIso(bundle.expires_at)) {
        throw new Error("Proof expired — ask the poster to re-prove");
    }

    const decoded = decodePublicInputs(bundle.public_inputs);
    const proofGridEmoji = gridToEmoji(
        decoded.grid.slice(0, decoded.numGuesses),
    );

    const answer = answerWord.trim().toLowerCase();
    if (answer.length !== 5) {
        throw new Error("Answer must be exactly 5 letters");
    }

    onPhase("Checking answer hash…");
    const answerHashFromWord = normalizeFieldHex(await hashAnswerWord(answer));

    onPhase("Loading dictionary…");
    const currentDictRoot = normalizeFieldHex(await getDictionaryRoot());

    const slackGrid = emojiRowsToGrid(slack.gridLines);
    const proofGrid = decoded.grid.slice(0, decoded.numGuesses);

    const checks: VerifyCheck[] = [
        {
            label: "Slack answer_hash matches proof",
            passed:
                slack.answerHash === bundle.answer_hash &&
                slack.answerHash === normalizeFieldHex(decoded.answerHash),
            detail: `${slack.answerHash.slice(0, 10)}…`,
        },
        {
            label: "Your answer matches answer_hash",
            passed: answerHashFromWord === bundle.answer_hash,
            detail: answer,
        },
        {
            label: "Slack grid matches proof",
            passed: gridsMatch(slackGrid, proofGrid),
        },
        {
            label: "Score matches",
            passed:
                slack.numGuesses === decoded.numGuesses &&
                slack.gridLines.length === decoded.numGuesses,
        },
        {
            label: "Dictionary matches this site",
            passed:
                normalizeFieldHex(bundle.dictionary_root) === currentDictRoot &&
                normalizeFieldHex(decoded.dictionaryRoot) === currentDictRoot,
        },
        {
            label: "Proof file internal consistency",
            passed:
                bundle.dictionary_root ===
                    normalizeFieldHex(decoded.dictionaryRoot) &&
                bundle.answer_hash === normalizeFieldHex(decoded.answerHash),
        },
    ];

    onPhase("Loading circuit…");
    const circuit = await loadCircuit();

    onPhase("Verifying ZKP…");
    const bbjs = await import("@aztec/bb.js");
    const { Barretenberg, UltraHonkBackend } = bbjs;
    const bb = await Barretenberg.new();
    const backend = new UltraHonkBackend(circuit.bytecode, bb);
    const proofBytes = base64ToBytes(bundle.proof_b64);

    const t0 = performance.now();
    const zkpValid = await backend.verifyProof({
        proof: proofBytes,
        publicInputs: bundle.public_inputs,
    });
    const verifyMs = performance.now() - t0;

    await bb.destroy();

    checks.push({
        label: "Zero-knowledge proof valid",
        passed: zkpValid,
    });

    if (decoded.numGuesses < 1 || decoded.numGuesses > MAX_GUESSES) {
        checks.push({
            label: "num_guesses in range",
            passed: false,
            detail: String(decoded.numGuesses),
        });
    }

    const allPassed = checks.every((c) => c.passed);

    return {
        slack,
        bundle,
        gridFromProof: proofGridEmoji,
        checks,
        verifyMs,
        allPassed,
    };
}
