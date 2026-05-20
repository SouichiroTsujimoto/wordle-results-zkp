import { NextResponse } from "next/server";
import { loadProofBundleResult } from "@/lib/proofStore";

export async function GET(
    _req: Request,
    ctx: { params: Promise<{ id: string }> },
) {
    const { id } = await ctx.params;
    const result = await loadProofBundleResult(id);

    if (result.status === "not_found") {
        return new NextResponse("Not found", { status: 404 });
    }

    if (result.status === "expired") {
        return NextResponse.json(
            { error: "Proof expired" },
            { status: 410 },
        );
    }

    return NextResponse.json(result.bundle, {
        headers: {
            "Cache-Control": "public, max-age=3600",
        },
    });
}
