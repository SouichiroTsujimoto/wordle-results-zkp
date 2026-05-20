/**
 * Poseidon2 Merkle tree matching noir-lang/merkle + Poseidon2Hasher.
 */
import { BarretenbergSync, fieldToString } from "@aztec/bb.js";

export const TREE_HEIGHT = 14;
export const NUM_LEAVES = 1 << TREE_HEIGHT;

export function frFromBigInt(x: bigint): Uint8Array {
    const buf = new Uint8Array(32);
    let v = x;
    for (let i = 31; i >= 0 && v > 0n; i--) {
        buf[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return buf;
}

export function encodeWordLetters(word: string): number[] {
    const w = word.trim().toLowerCase();
    if (w.length !== 5) throw new Error(`bad word: ${word}`);
    return [...w].map((c) => c.charCodeAt(0) - "a".charCodeAt(0));
}

function hashPair(bb: BarretenbergSync, left: Uint8Array, right: Uint8Array): Uint8Array {
    return bb.poseidon2Hash({ inputs: [left, right] }).hash;
}

export function hashWord(bb: BarretenbergSync, letters: number[]): Uint8Array {
    return bb.poseidon2Hash({
        inputs: letters.map((n) => frFromBigInt(BigInt(n))),
    }).hash;
}

export function buildTree(leaves: Uint8Array[], bb: BarretenbergSync): Uint8Array[] {
    const n = leaves.length;
    const nodes: Uint8Array[] = new Array(n - 1);
    const half = n / 2;
    for (let i = 0; i < half; i++) {
        nodes[i] = hashPair(bb, leaves[2 * i], leaves[2 * i + 1]);
    }
    for (let i = 0; i < n - 1 - half; i++) {
        nodes[half + i] = hashPair(bb, nodes[2 * i], nodes[2 * i + 1]);
    }
    return nodes;
}

function siblingIndex(index: number): number {
    return index % 2 === 0 ? index + 1 : index - 1;
}

export function getSiblingPath(
    leaves: Uint8Array[],
    nodes: Uint8Array[],
    leafIndex: number,
): string[] {
    const n = leaves.length;
    const path: Uint8Array[] = new Array(TREE_HEIGHT);
    let currentIndex = leafIndex;
    let subtreeWidth = n;
    let subtreeOffset = 0;

    path[0] = leaves[siblingIndex(currentIndex)];

    for (let level = 1; level < TREE_HEIGHT; level++) {
        currentIndex = Math.floor(currentIndex / 2);
        subtreeWidth = Math.floor(subtreeWidth / 2);
        path[level] = nodes[subtreeOffset + siblingIndex(currentIndex)];
        subtreeOffset += subtreeWidth;
    }

    return path.map((h) => "0x" + fieldToString(h, 16));
}

export function fieldHex(bb: BarretenbergSync, letters: number[]): string {
    return "0x" + fieldToString(hashWord(bb, letters), 16);
}
