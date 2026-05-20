/**
 * Vercel post-build workaround: when Root Directory is `webapp`, the Next.js 16
 * validator looks for `.next` at the repo root instead of `webapp/.next`.
 * https://github.com/vercel/vercel/issues/15937
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webappRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.join(webappRoot, "..");
const src = path.join(webappRoot, ".next");
const dest = path.join(repoRoot, ".next");

if (!process.env.VERCEL || !fs.existsSync(src)) {
    process.exit(0);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log("Copied webapp/.next to repo root for Vercel validation");
