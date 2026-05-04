import { NextResponse } from "next/server";

import { jsonError } from "@/src/server/api-response";
import { HttpError } from "@/src/server/errors";
import { sanitizeMoment } from "@/src/server/looki-client";
import { getLookiClientForUid } from "@/src/server/looki-profile";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const uid = url.searchParams.get("uid")?.trim();
    const date = url.searchParams.get("date")?.trim();
    if (!uid) throw new HttpError(400, "Omi uid is required");
    if (!date) throw new HttpError(400, "Date is required");
    const { client } = await getLookiClientForUid(uid);
    const moments = (await client.listMoments(date)).map(sanitizeMoment);
    return NextResponse.json({ moments });
  } catch (error) {
    return jsonError(error);
  }
}
