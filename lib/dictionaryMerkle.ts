/**
 * Client-side dictionary Merkle proofs (built from public/wordle dictionary data).
 */
import {
    NUM_LEAVES,
    TREE_HEIGHT,
    buildTree,
    encodeWordLetters,
    frFromBigInt,
    getSiblingPath,
    hashWord,
} from "./merkleCore";

export { TREE_HEIGHT };

interface DictionaryMeta {
    root: string;
    numWords: number;
    treeHeight: number;
    numLeaves: number;
}

interface DictionaryWords {
    words: string[];
    wordIndex: Record<string, number>;
}

let cachedMeta: Promise<DictionaryMeta> | null = null;
let cachedWords: Promise<DictionaryWords> | null = null;
let cachedTree: Promise<{
    leaves: Uint8Array[];
    nodes: Uint8Array[];
}> | null = null;

async function loadMeta(): Promise<DictionaryMeta> {
    if (!cachedMeta) {
        cachedMeta = fetch("/dictionary/meta.json").then((r) => {
            if (!r.ok) throw new Error("missing dictionary/meta.json — run npm run dict:build");
            return r.json() as Promise<DictionaryMeta>;
        });
    }
    return cachedMeta;
}

async function loadWords(): Promise<DictionaryWords> {
    if (!cachedWords) {
        cachedWords = fetch("/dictionary/words.json").then((r) => {
            if (!r.ok) throw new Error("missing dictionary/words.json");
            return r.json() as Promise<DictionaryWords>;
        });
    }
    return cachedWords;
}

async function loadTree() {
    if (!cachedTree) {
        cachedTree = (async () => {
            const [{ BarretenbergSync }, words] = await Promise.all([
                import("@aztec/bb.js"),
                loadWords(),
            ]);
            const bb = await BarretenbergSync.new();
            const zero = frFromBigInt(0n);
            const leaves: Uint8Array[] = new Array(NUM_LEAVES).fill(zero);
            for (let i = 0; i < words.words.length; i++) {
                leaves[i] = hashWord(bb, encodeWordLetters(words.words[i]));
            }
            const nodes = buildTree(leaves, bb);
            return { leaves, nodes };
        })();
    }
    return cachedTree;
}

export async function getDictionaryRoot(): Promise<string> {
    const meta = await loadMeta();
    return meta.root;
}

export interface WordMembershipProof {
    index: string;
    path: string[];
}

export async function getWordProof(word: string): Promise<WordMembershipProof> {
    const w = word.trim().toLowerCase();
    const { wordIndex } = await loadWords();
    const idx = wordIndex[w];
    if (idx === undefined) {
        throw new Error(`"${word}" is not in the allowed dictionary`);
    }
    const { leaves, nodes } = await loadTree();
    return {
        index: idx.toString(),
        path: getSiblingPath(leaves, nodes, idx),
    };
}

export async function getProofsForWords(
    words: string[],
): Promise<WordMembershipProof[]> {
    return Promise.all(words.map(getWordProof));
}
