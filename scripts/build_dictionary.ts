/**
 * Build dictionary Merkle metadata. Run: npm run dict:build
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BarretenbergSync, fieldToString } from "@aztec/bb.js";
import {
    NUM_LEAVES,
    TREE_HEIGHT,
    buildTree,
    encodeWordLetters,
    frFromBigInt,
    getSiblingPath,
    hashWord,
} from "./merkle.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

async function main() {
    const wordsPath = resolve(ROOT, "data/wordle/allowed_guesses.txt");
    const words = readFileSync(wordsPath, "utf-8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .sort();

    if (words.length > NUM_LEAVES) {
        throw new Error(`too many words: ${words.length} > ${NUM_LEAVES}`);
    }

    console.log(`Loaded ${words.length} words`);
    const bb = await BarretenbergSync.new();

    const zeroLeaf = frFromBigInt(0n);
    const leaves: Uint8Array[] = new Array(NUM_LEAVES).fill(zeroLeaf);
    const wordIndex: Record<string, number> = {};

    for (let i = 0; i < words.length; i++) {
        leaves[i] = hashWord(bb, encodeWordLetters(words[i]));
        wordIndex[words[i]] = i;
    }

    const nodes = buildTree(leaves, bb);
    const rootHex = "0x" + fieldToString(nodes[NUM_LEAVES - 2], 16);
    console.log(`Merkle root: ${rootHex}`);

    const outDir = resolve(ROOT, "data/merkle");
    mkdirSync(outDir, { recursive: true });

    writeFileSync(
        resolve(outDir, "meta.json"),
        JSON.stringify(
            {
                treeHeight: TREE_HEIGHT,
                numLeaves: NUM_LEAVES,
                numWords: words.length,
                root: rootHex,
            },
            null,
            2,
        ),
    );
    writeFileSync(
        resolve(outDir, "words.json"),
        JSON.stringify({ words, wordIndex }),
    );

    const craneIdx = wordIndex["crane"];
    console.log(
        `crane proof ok: ${getSiblingPath(leaves, nodes, craneIdx).length} siblings`,
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
