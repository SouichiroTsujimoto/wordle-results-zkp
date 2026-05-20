/**
 * Step 2 smoke test:
 *   Prove "I know x such that pedersen_hash([x]) == y" entirely from Node,
 *   using the exact same JS APIs the browser app will use later:
 *     - @noir-lang/noir_js   for witness generation
 *     - @aztec/bb.js         for UltraHonk proof generation & verification
 *
 * Run with: npm run hash:run
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Noir } from "@noir-lang/noir_js";
import {
    Barretenberg,
    BarretenbergSync,
    UltraHonkBackend,
    fieldToString,
} from "@aztec/bb.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/** Big-endian 32-byte encoding of a non-negative integer field element. */
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

interface CompiledCircuit {
    bytecode: string;
    abi: unknown;
}

async function main() {
    const acirPath = resolve(ROOT, "target/hash_preimage.json");
    const program: CompiledCircuit = JSON.parse(readFileSync(acirPath, "utf-8"));

    // 1. Compute y = pedersen_hash([x]) on the JS side using bb.js's native
    //    primitive. This is identical to the `std::hash::pedersen_hash`
    //    function we call inside the circuit, so both sides agree on y.
    const bbSync = await BarretenbergSync.new();
    const x = 42n;
    const { hash: yBytes } = bbSync.pedersenHash({
        inputs: [frFromBigInt(x)],
        hashIndex: 0,
    });
    const y = fieldToString(yBytes);
    console.log(`x (witness, private) = ${x}`);
    console.log(`y (public input)     = ${y}`);

    // 2. Run the circuit's witness generator in JS.
    const noir = new Noir(program as never);
    const { witness } = await noir.execute({ x: x.toString(), y });
    console.log(`witness bytes (gzipped) = ${witness.length}`);

    // 3. Prove using UltraHonk via bb.js — the same path the browser will use.
    const bb = await Barretenberg.new();
    const backend = new UltraHonkBackend(program.bytecode, bb);

    console.log("Proving...");
    const t0 = performance.now();
    const proof = await backend.generateProof(witness);
    console.log(`  proof bytes        = ${proof.proof.length}`);
    console.log(`  public inputs      = ${JSON.stringify(proof.publicInputs)}`);
    console.log(`  prove time         = ${(performance.now() - t0).toFixed(0)} ms`);

    // 4. Verify using the same backend.
    console.log("Verifying...");
    const t1 = performance.now();
    const verified = await backend.verifyProof(proof);
    console.log(`  verify time        = ${(performance.now() - t1).toFixed(0)} ms`);
    console.log(`  verified           = ${verified}`);

    // 5. Sanity check: the public input embedded in the proof must equal y.
    const expected = BigInt(y);
    const actual = BigInt(proof.publicInputs[0]);
    if (expected !== actual) {
        throw new Error(`public input mismatch: ${actual} != ${expected}`);
    }

    // 6. Negative test: tampering with the public input must make verification
    //    fail. This is the property Slack-pasted "PROOF" lines depend on.
    console.log("Negative test: verifying with a tampered public input...");
    const tampered = {
        ...proof,
        publicInputs: ["0x" + (BigInt(proof.publicInputs[0]) + 1n).toString(16)],
    };
    const tamperedVerified = await backend.verifyProof(tampered);
    console.log(`  tampered verified  = ${tamperedVerified} (expected false)`);

    await bb.destroy();
    const ok = verified && !tamperedVerified;
    if (!ok) process.exit(1);
    console.log("All checks passed.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
