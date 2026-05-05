import { NextResponse } from "next/server";

import { jsonError } from "@/src/server/api-response";
import { summarizeMonthlyAsrUsage } from "@/src/server/asr-usage";
import { HttpError } from "@/src/server/errors";
import { getStore } from "@/src/server/store";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const uid = new URL(request.url).searchParams.get("uid")?.trim();
    if (!uid) throw new HttpError(400, "Omi uid is required");
    const ledger = await getStore().listLedger(uid);
    return NextResponse.json({
      ledger: ledger.slice(0, 50),
      usage: summarizeMonthlyAsrUsage(ledger),
    });
  } catch (error) {
    return jsonError(error);
  }
}
