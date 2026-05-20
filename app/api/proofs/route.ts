import { NextRequest, NextResponse } from "next/server";
import { parseProofBundleJson } from "@/lib/slackFormat";
import { proofBundleId } from "@/lib/proofUrl";
import { saveProofBundle } from "@/lib/proofStore";

export async function POST(req: NextRequest) {
    try {
        const raw = await req.text();
        if (raw.length > 512_000) {
            return NextResponse.json(
                { error: "proof bundle too large" },
                { status: 413 },
            );
        }

        const bundle = parseProofBundleJson(raw);
        const id = proofBundleId(bundle);
        await saveProofBundle(id, bundle);

        return NextResponse.json({
            id,
            url: `${req.nextUrl.origin}/proof/${id}.json`,
        });
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: message }, { status: 400 });
    }
}
