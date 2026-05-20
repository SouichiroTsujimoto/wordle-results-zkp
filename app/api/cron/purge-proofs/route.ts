import { NextResponse } from "next/server";
import { purgeExpiredProofs } from "@/lib/proofStore";
import { proofExpiryLabel } from "@/lib/proofTtl";

export async function GET(req: Request) {
    const auth = req.headers.get("authorization");
    const secret = process.env.CRON_SECRET;
    if (!secret || auth !== `Bearer ${secret}`) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    const { scanned, deleted } = await purgeExpiredProofs();

    return NextResponse.json({
        ok: true,
        ttl: proofExpiryLabel(),
        scanned,
        deleted,
    });
}
