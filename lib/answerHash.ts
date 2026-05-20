/**
 * Pedersen hash of a 5-letter Wordle answer (letter encoding a=0..z=25).
 * Matches `circuits/wordle_judge/src/answer_hash.nr`.
 */
import { fieldToString } from "@aztec/bb.js";
import { encodeWordLetters, frFromBigInt } from "./merkleCore";

export async function hashAnswerWord(word: string): Promise<string> {
    const letters = encodeWordLetters(word);
    const { BarretenbergSync } = await import("@aztec/bb.js");
    const bb = await BarretenbergSync.new();
    const { hash } = bb.pedersenHash({
        inputs: letters.map((n) => frFromBigInt(BigInt(n))),
        hashIndex: 0,
    });
    return "0x" + fieldToString(hash, 16);
}

/** Decimal string form for noir_js public inputs. */
export async function hashAnswerWordDecimal(word: string): Promise<string> {
    const hex = await hashAnswerWord(word);
    return BigInt(hex).toString();
}
