"use client";

import { useMemo, useRef, useState } from "react";
import {
    proveWordleJudge,
    previewGrid,
    type WordleJudgeResult,
} from "@/lib/wordleJudge";
import { verifyWordleSubmission, type WordleVerifyResult } from "@/lib/wordleVerify";
import { DEMO, MAX_GUESSES, validateGuessWords } from "@/lib/wordle";
import {
    formatSlackPaste,
    copyToClipboard,
    buildProofBundle,
    downloadProofBundle,
    truncateHex,
    parseSlackPaste,
    formatSlackDate,
} from "@/lib/slackFormat";
import { fetchProofJsonFromUrl, publishProofBundle } from "@/lib/proofUrl";
import { extractGuessesFromScreenshot } from "@/lib/wordleScreenshotOcr";

type Tab = "prove" | "verify";
type Status = "idle" | "running" | "done" | "error";

const INITIAL_GUESS_ROWS = [{ id: 0, word: "" }];

export default function Home() {
    const [tab, setTab] = useState<Tab>("prove");

    return (
        <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 p-6 sm:p-8">
            <header className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                    Wordle ZKP
                </h1>
                <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    Sign your Wordle result with a zero-knowledge proof, post it
                    on Slack, and let others verify it in the browser. Proving
                    and verification run entirely client-side.
                </p>
            </header>

            <div className="flex gap-1 rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-700 dark:bg-zinc-900">
                <TabButton
                    active={tab === "prove"}
                    onClick={() => setTab("prove")}
                >
                    Prove
                </TabButton>
                <TabButton
                    active={tab === "verify"}
                    onClick={() => setTab("verify")}
                >
                    Verify
                </TabButton>
            </div>

            <div className={tab === "prove" ? undefined : "hidden"}>
                <ProvePanel />
            </div>
            <div className={tab === "verify" ? undefined : "hidden"}>
                <VerifyPanel />
            </div>
        </main>
    );
}

function TabButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
        >
            {children}
        </button>
    );
}

type GuessRow = { id: number; word: string };

function ProvePanel() {
    const nextId = useRef(1);
    const ocrInputRef = useRef<HTMLInputElement>(null);
    const [answer, setAnswer] = useState("");
    const [guessRows, setGuessRows] = useState<GuessRow[]>(INITIAL_GUESS_ROWS);
    const guesses = guessRows.map((r) => r.word);
    const [status, setStatus] = useState<Status>("idle");
    const [phase, setPhase] = useState("");
    const [ocrBusy, setOcrBusy] = useState(false);
    const [ocrPhase, setOcrPhase] = useState("");
    const [ocrError, setOcrError] = useState<string | null>(null);
    const [ocrFilledCount, setOcrFilledCount] = useState<number | null>(null);
    const [ocrSkippedCount, setOcrSkippedCount] = useState<number | null>(null);
    const [result, setResult] = useState<WordleJudgeResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState<"slack" | "url" | null>(null);
    const [proofUrl, setProofUrl] = useState<string | null>(null);
    const [publishError, setPublishError] = useState<string | null>(null);

    const preview = useMemo(() => {
        try {
            if (!answer || guesses.every((g) => g.length === 0)) return null;
            return previewGrid(answer, guesses.filter((g) => g.length === 5));
        } catch {
            return null;
        }
    }, [answer, guesses]);

    function resetForm() {
        if (status === "running") return;
        nextId.current = 1;
        setAnswer("");
        setGuessRows([{ id: 0, word: "" }]);
        setStatus("idle");
        setPhase("");
        setResult(null);
        setError(null);
        setCopied(null);
        setProofUrl(null);
        setPublishError(null);
        setOcrBusy(false);
        setOcrPhase("");
        setOcrError(null);
        setOcrFilledCount(null);
        setOcrSkippedCount(null);
    }

    function setGuess(id: number, value: string) {
        setGuessRows((prev) =>
            prev.map((row) =>
                row.id === id ? { ...row, word: value.toLowerCase() } : row,
            ),
        );
    }

    function addGuess() {
        if (guessRows.length < MAX_GUESSES) {
            setGuessRows((prev) => [
                ...prev,
                { id: nextId.current++, word: "" },
            ]);
        }
    }

    function removeGuess(id: number) {
        if (guessRows.length > 1) {
            setGuessRows((prev) => prev.filter((row) => row.id !== id));
        }
    }

    async function handleScreenshotImport(
        event: React.ChangeEvent<HTMLInputElement>,
    ) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file || status === "running" || ocrBusy) return;

        setOcrBusy(true);
        setOcrError(null);
        setOcrFilledCount(null);
        setOcrSkippedCount(null);
        try {
            const words = await extractGuessesFromScreenshot(file, setOcrPhase);
            nextId.current = words.length;
            setGuessRows(
                words.map((word, index) => ({ id: index, word })),
            );
            setOcrFilledCount(words.filter((word) => word.length === 5).length);
            setOcrSkippedCount(words.filter((word) => word.length === 0).length);
        } catch (e) {
            setOcrError(e instanceof Error ? e.message : String(e));
        } finally {
            setOcrBusy(false);
            setOcrPhase("");
        }
    }

    async function run() {
        setStatus("running");
        setError(null);
        setResult(null);
        setProofUrl(null);
        setPublishError(null);
        try {
            const activeGuesses = guesses.filter((g) => g.length === 5);
            const r = await proveWordleJudge(answer, activeGuesses, setPhase);
            setResult(r);
            setPhase("Publishing proof URL…");
            const bundle = buildProofBundle({
                answerHash: r.answerHash,
                dictionaryRoot: r.dictionaryRoot,
                publicInputs: r.publicInputs,
                proofBytes: r.proofBytes,
            });
            try {
                const published = await publishProofBundle(bundle);
                setProofUrl(published.url);
            } catch (e) {
                setPublishError(
                    e instanceof Error ? e.message : String(e),
                );
            }
            setStatus("done");
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setStatus("error");
        }
    }

    const filledGuesses = guesses.filter((g) => g.length === 5);
    const guessValidationError = useMemo(() => {
        if (answer.length !== 5 || filledGuesses.length === 0) return null;
        if (!guesses.every((g) => g.length === 5)) return null;
        return validateGuessWords(answer, filledGuesses);
    }, [answer, guesses, filledGuesses]);

    const canRun =
        answer.length === 5 &&
        guesses.every((g) => g.length === 5) &&
        guessValidationError === null;

    async function copySlackPaste() {
        if (!result) return;
        const text = formatSlackPaste({
            numGuesses: result.numGuesses,
            gridEmoji: result.gridEmoji,
            answerHash: result.answerHash,
            proofUrl: proofUrl ?? undefined,
        });
        await copyToClipboard(text);
        setCopied("slack");
        setTimeout(() => setCopied(null), 2000);
    }

    async function copyProofUrl() {
        if (!proofUrl) return;
        await copyToClipboard(proofUrl);
        setCopied("url");
        setTimeout(() => setCopied(null), 2000);
    }

    function downloadProofFile() {
        if (!result) return;
        downloadProofBundle(
            buildProofBundle({
                answerHash: result.answerHash,
                dictionaryRoot: result.dictionaryRoot,
                publicInputs: result.publicInputs,
                proofBytes: result.proofBytes,
            }),
            `wordle-${formatSlackDate()}-proof.json`,
        );
    }

    const slackPreview =
        result &&
        formatSlackPaste({
            numGuesses: result.numGuesses,
            gridEmoji: result.gridEmoji,
            answerHash: result.answerHash,
            proofUrl: proofUrl ?? undefined,
        });

    return (
        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-5 text-sm text-zinc-600 dark:text-zinc-400">
                Enter your secret answer and guesses to generate a proof. Only
                the emoji grid and answer_hash are shared on Slack — the words
                themselves stay private.
            </p>

            {error && <ErrorBox message={error} className="mb-5" />}

            {result && (
                <div className="mb-5 space-y-4 border-b border-zinc-200 pb-5 dark:border-zinc-800">
                    <div
                        className={`rounded-lg p-4 text-center text-sm font-medium ${
                            result.verified
                                ? "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300"
                                : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                        }`}
                    >
                        {result.verified
                            ? `Proof ready (${result.numGuesses}/6)`
                            : "Proof generation failed"}
                    </div>

                    {publishError && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                            Could not publish proof URL: {publishError}
                        </p>
                    )}

                    {proofUrl && (
                        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-950">
                            <p className="text-xs font-medium text-zinc-500">
                                Proof URL
                            </p>
                            <p className="mt-1 break-all font-mono text-xs text-zinc-800 dark:text-zinc-200">
                                {proofUrl}
                            </p>
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={copySlackPaste}
                        disabled={!proofUrl}
                        className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-400"
                    >
                        {copied === "slack"
                            ? "Copied!"
                            : "Copy Slack message"}
                    </button>

                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={copyProofUrl}
                            disabled={!proofUrl}
                            className="inline-flex flex-1 items-center justify-center rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                            {copied === "url" ? "Copied!" : "Copy proof URL"}
                        </button>
                        <button
                            type="button"
                            onClick={downloadProofFile}
                            className="inline-flex flex-1 items-center justify-center rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                            Download JSON
                        </button>
                    </div>

                    {slackPreview && (
                        <details className="text-xs text-zinc-500">
                            <summary className="cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300">
                                Message preview
                            </summary>
                            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
                                {slackPreview}
                            </pre>
                        </details>
                    )}

                    <details className="text-xs text-zinc-500">
                        <summary className="cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300">
                            Technical details
                        </summary>
                        <div className="mt-2 space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                            <ResultRow
                                label="answer hash"
                                value={truncateHex(result.answerHash)}
                            />
                            <ResultRow
                                label="proof size"
                                value={`${result.proofBytes.length.toLocaleString()} bytes`}
                            />
                            <ResultRow
                                label="prove time"
                                value={`${result.proveMs.toFixed(0)} ms`}
                            />
                        </div>
                    </details>
                </div>
            )}

            <label className="block">
                <span className="text-sm font-medium">Answer (secret)</span>
                <input
                    type="text"
                    maxLength={5}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value.toLowerCase())}
                    disabled={status === "running"}
                    placeholder={DEMO.answer.toUpperCase()}
                    className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white p-2.5 font-mono text-sm uppercase dark:border-zinc-700 dark:bg-zinc-950"
                />
            </label>

            <div className="mt-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">Guesses (secret)</span>
                    <div className="flex items-center gap-2">
                        <input
                            ref={ocrInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleScreenshotImport}
                        />
                        <button
                            type="button"
                            onClick={() => ocrInputRef.current?.click()}
                            disabled={status === "running" || ocrBusy}
                            className="text-sm text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
                        >
                            {ocrBusy ? "Reading…" : "Import from screenshot"}
                        </button>
                    </div>
                </div>
                {ocrBusy && ocrPhase && (
                    <p className="text-xs text-zinc-500">{ocrPhase}</p>
                )}
                {ocrError && (
                    <p className="text-xs text-red-600 dark:text-red-400">
                        {ocrError}
                    </p>
                )}
                {ocrFilledCount !== null && !ocrError && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                        Filled {ocrFilledCount} guess
                        {ocrFilledCount === 1 ? "" : "es"} from screenshot.
                        {ocrSkippedCount !== null && ocrSkippedCount > 0 && (
                            <>
                                {" "}
                                {ocrSkippedCount} row
                                {ocrSkippedCount === 1 ? "" : "s"} could not
                                be read — check and edit.
                            </>
                        )}
                        {!answer && " Answer is not filled — enter it above."}
                    </p>
                )}
                <p className="text-xs text-zinc-500">
                    Use an in-game screenshot with visible letters. Emoji-only
                    share grids cannot be read.
                </p>
                {guessRows.map((row, i) => (
                    <div key={row.id} className="flex gap-2">
                        <span className="w-6 pt-2.5 text-xs text-zinc-400">
                            {i + 1}
                        </span>
                        <input
                            type="text"
                            maxLength={5}
                            value={row.word}
                            onChange={(e) => setGuess(row.id, e.target.value)}
                            disabled={status === "running"}
                            placeholder={
                                (DEMO.guesses[i] ?? DEMO.answer).toUpperCase()
                            }
                            className="block flex-1 rounded-lg border border-zinc-300 bg-white p-2.5 font-mono text-sm uppercase dark:border-zinc-700 dark:bg-zinc-950"
                        />
                        {guessRows.length > 1 && (
                            <button
                                type="button"
                                onClick={() => removeGuess(row.id)}
                                disabled={status === "running"}
                                className="rounded px-2 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                aria-label="Remove guess"
                            >
                                ×
                            </button>
                        )}
                    </div>
                ))}
                {guessRows.length < MAX_GUESSES && (
                    <button
                        type="button"
                        onClick={addGuess}
                        disabled={status === "running"}
                        className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                    >
                        + add guess
                    </button>
                )}
            </div>

            {preview && (
                <pre className="mt-4 rounded-lg bg-zinc-100 p-4 text-center text-2xl leading-relaxed dark:bg-zinc-950">
                    {preview}
                </pre>
            )}

            {!canRun && answer.length > 0 && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    {guessValidationError ??
                        "All words must be 5 letters, and the final guess must match the answer."}
                </p>
            )}

            <ActionRow
                status={status}
                phase={phase}
                onRun={run}
                onReset={resetForm}
                runLabel="Generate proof"
                disabled={!canRun}
            />
        </section>
    );
}

function VerifyPanel() {
    const [slackText, setSlackText] = useState("");
    const [proofUrl, setProofUrl] = useState("");
    const [answer, setAnswer] = useState("");
    const [status, setStatus] = useState<Status>("idle");
    const [phase, setPhase] = useState("");
    const [result, setResult] = useState<WordleVerifyResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    function resetForm() {
        if (status === "running") return;
        setSlackText("");
        setProofUrl("");
        setAnswer("");
        setStatus("idle");
        setPhase("");
        setResult(null);
        setError(null);
    }

    function onSlackChange(text: string) {
        setSlackText(text);
        try {
            const parsed = parseSlackPaste(text);
            if (parsed.proofUrl) {
                setProofUrl(parsed.proofUrl);
            }
        } catch {
            // ignore until verify
        }
    }

    async function run() {
        setStatus("running");
        setError(null);
        setResult(null);
        try {
            if (!proofUrl.trim()) {
                throw new Error("Enter a proof URL");
            }
            setPhase("Fetching proof…");
            const { json } = await fetchProofJsonFromUrl(proofUrl);
            const r = await verifyWordleSubmission(
                slackText,
                json,
                answer,
                setPhase,
            );
            setResult(r);
            setStatus("done");
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setStatus("error");
        }
    }

    const canRun =
        slackText.trim().length > 0 &&
        proofUrl.trim().length > 0 &&
        answer.trim().length === 5;

    return (
        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-5 text-sm text-zinc-600 dark:text-zinc-400">
                Paste the Slack message, proof URL, and today&apos;s answer word
                to verify a result.
            </p>

            {error && <ErrorBox message={error} className="mb-5" />}

            {result && (
                <div className="mb-5 space-y-4 border-b border-zinc-200 pb-5 dark:border-zinc-800">
                    <div
                        className={`rounded-lg p-4 text-center font-medium ${
                            result.allPassed
                                ? "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300"
                                : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                        }`}
                    >
                        {result.allPassed
                            ? "Verified — this result is authentic."
                            : "Verification failed — do not trust this result."}
                    </div>

                    <div className="flex items-center justify-between text-sm">
                        <span className="text-zinc-500">Score</span>
                        <span className="font-medium">
                            {result.slack.numGuesses}/{result.slack.maxGuesses}
                        </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-zinc-500">Date</span>
                        <span className="font-mono">{result.slack.date}</span>
                    </div>

                    <pre className="rounded-lg bg-zinc-100 p-4 text-center text-xl leading-relaxed dark:bg-zinc-950">
                        {result.slack.gridEmoji}
                    </pre>

                    <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                            Verification checks
                        </p>
                        <CheckList checks={result.checks} />
                    </div>
                </div>
            )}

            <label className="block">
                <span className="text-sm font-medium">Slack message</span>
                <textarea
                    rows={10}
                    value={slackText}
                    onChange={(e) => onSlackChange(e.target.value)}
                    disabled={status === "running"}
                    placeholder={`[Wordle 2/6 2026-05-21]\n\n⬛⬛🟩⬛🟩\n🟩🟩🟩🟩🟩\n\n-PROOF-\nanswer_hash: 0x...\nproof: https://.../proof/abc.json`}
                    className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white p-2.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
                />
            </label>

            <label className="mt-4 block">
                <span className="text-sm font-medium">Proof URL</span>
                <input
                    type="url"
                    value={proofUrl}
                    onChange={(e) => setProofUrl(e.target.value)}
                    disabled={status === "running"}
                    placeholder="https://..."
                    className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white p-2.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
                />
                <p className="mt-1 text-xs text-zinc-500">
                    Auto-filled from the <code className="font-mono">proof:</code>{" "}
                    line when present.
                </p>
            </label>

            <label className="mt-4 block">
                <span className="text-sm font-medium">
                    Today&apos;s answer (5 letters)
                </span>
                <input
                    type="text"
                    maxLength={5}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value.toLowerCase())}
                    disabled={status === "running"}
                    placeholder={DEMO.answer.toUpperCase()}
                    className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white p-2.5 font-mono text-sm uppercase dark:border-zinc-700 dark:bg-zinc-950"
                />
                <p className="mt-1 text-xs text-zinc-500">
                    Used only to check against answer_hash. Never sent
                    anywhere.
                </p>
            </label>

            <ActionRow
                status={status}
                phase={phase}
                onRun={run}
                onReset={resetForm}
                runLabel="Verify"
                disabled={!canRun}
            />
        </section>
    );
}

function ActionRow({
    status,
    phase,
    onRun,
    onReset,
    runLabel,
    disabled,
}: {
    status: Status;
    phase: string;
    onRun: () => void;
    onReset: () => void;
    runLabel: string;
    disabled?: boolean;
}) {
    return (
        <div className="mt-5 flex gap-2">
            <button
                type="button"
                onClick={onReset}
                disabled={status === "running"}
                className="inline-flex items-center justify-center rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
                Reset
            </button>
            <button
                type="button"
                onClick={onRun}
                disabled={status === "running" || disabled}
                className="inline-flex flex-1 items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
                {status === "running" ? phase || "Working…" : runLabel}
            </button>
        </div>
    );
}

function CheckList({
    checks,
}: {
    checks: WordleVerifyResult["checks"];
}) {
    return (
        <div className="space-y-1.5 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            {checks.map((check) => (
                <div
                    key={check.label}
                    className="flex items-start gap-2 text-sm"
                >
                    <span
                        className={
                            check.passed
                                ? "text-green-600 dark:text-green-400"
                                : "text-red-600 dark:text-red-400"
                        }
                    >
                        {check.passed ? "✓" : "✗"}
                    </span>
                    <div>
                        <span>{check.label}</span>
                        {check.detail && (
                            <span className="ml-1 font-mono text-xs text-zinc-500">
                                ({check.detail})
                            </span>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

function ErrorBox({
    message,
    className = "",
}: {
    message: string;
    className?: string;
}) {
    return (
        <pre
            className={`overflow-x-auto whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 ${className}`}
        >
            {message}
        </pre>
    );
}

function ResultRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="uppercase tracking-wide text-zinc-500">
                {label}
            </span>
            <span className="font-mono break-all text-zinc-700 dark:text-zinc-300">
                {value}
            </span>
        </div>
    );
}
