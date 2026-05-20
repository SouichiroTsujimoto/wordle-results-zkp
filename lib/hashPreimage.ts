/**
 * Browser-side runner for the step-2 hash-preimage circuit.
 *
 * Mirrors `scripts/hash_preimage.ts` but uses the browser builds of bb.js
 * and noir_js. The ACIR is fetched from `/circuits/hash_preimage.json`
 * (synced from the Noir workspace's `target/` by `npm run sync-circuits`).
 *
 * NOTE: every reference to `@aztec/bb.js` and `@noir-lang/noir_js` lives
 * behind a dynamic `await import(...)` so neither package shows up on the
 * server-side import graph. This is what keeps `next dev` from trying to
 * bundle hundreds of MBs of WASM-related code at boot.
 */

export interface HashPreimageResult {
    xDecimal: string;
    yHex: string;
    yDecimal: string;
    proofBytes: number;
    proveMs: number;
    verifyMs: number;
    verified: boolean;
    tamperedVerified: boolean;
}

interface CompiledCircuit {
    bytecode: string;
    abi: unknown;
}

/** Big-endian 32-byte encoding of a non-negative field element. */
function frFromBigInt(x: bigint): Uint8Array {
    if (x < 0n) throw new Error("negative field element");
    const buf = new Uint8Array(32);
    let v = x;
    for (let i = 31; i >= 0 && v > 0n; i--) {
        buf[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return buf;
}

function bytesToHex(bytes: Uint8Array): string {
    return (
        "0x" +
        Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
    );
}

/** Cache the compiled circuit between runs so we don't refetch on every click. */
let cachedCircuit: Promise<CompiledCircuit> | null = null;
function loadCircuit(): Promise<CompiledCircuit> {
    if (!cachedCircuit) {
        cachedCircuit = fetch("/circuits/hash_preimage.json").then((r) => {
            if (!r.ok) {
                throw new Error(
                    `failed to load circuit: ${r.status} ${r.statusText}. ` +
                        `Did you run \`nargo compile --package hash_preimage\` ` +
                        `then \`npm run sync-circuits\`?`,
                );
            }
            return r.json() as Promise<CompiledCircuit>;
        });
    }
    return cachedCircuit;
}

export async function proveHashPreimage(
    x: bigint,
    onPhase: (phase: string) => void = () => {},
): Promise<HashPreimageResult> {
    onPhase("Loading circuit");
    const circuit = await loadCircuit();

    // Load the heavy WASM-backed libraries lazily so they never touch the
    // server bundle and don't run until the user actually clicks the button.
    onPhase("Loading bb.js & noir_js");
    const [{ Noir }, bbjs] = await Promise.all([
        import("@noir-lang/noir_js"),
        import("@aztec/bb.js"),
    ]);
    const { Barretenberg, BarretenbergSync, UltraHonkBackend, fieldToString } =
        bbjs;

    onPhase("Hashing");
    const bbSync = await BarretenbergSync.new();
    const { hash: yBytes } = bbSync.pedersenHash({
        inputs: [frFromBigInt(x)],
        hashIndex: 0,
    });
    const yDecimal = fieldToString(yBytes);
    const yHex = bytesToHex(yBytes);

    onPhase("Generating witness");
    const noir = new Noir(circuit as never);
    const { witness } = await noir.execute({ x: x.toString(), y: yDecimal });

    onPhase("Proving (this is the slow part)");
    const bb = await Barretenberg.new();
    const backend = new UltraHonkBackend(circuit.bytecode, bb);
    const t0 = performance.now();
    const proof = await backend.generateProof(witness);
    const proveMs = performance.now() - t0;

    onPhase("Verifying");
    const t1 = performance.now();
    const verified = await backend.verifyProof(proof);
    const verifyMs = performance.now() - t1;

    onPhase("Negative test (tampered public input)");
    const tampered = {
        ...proof,
        publicInputs: [
            "0x" + (BigInt(proof.publicInputs[0]) + 1n).toString(16),
        ],
    };
    const tamperedVerified = await backend.verifyProof(tampered);

    await bb.destroy();

    return {
        xDecimal: x.toString(),
        yHex,
        yDecimal,
        proofBytes: proof.proof.length,
        proveMs,
        verifyMs,
        verified,
        tamperedVerified,
    };
}
