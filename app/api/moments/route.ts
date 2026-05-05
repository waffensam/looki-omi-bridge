import { NextResponse } from "next/server";

import { jsonError } from "@/src/server/api-response";
import { HttpError } from "@/src/server/errors";
import { sanitizeMoment } from "@/src/server/looki-client";
import { getLookiClientForUid } from "@/src/server/looki-profile";
import {
  attachForYouHintsToMoments,
  sanitizeForYouItem,
} from "@/src/looki-for-you";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const uid = url.searchParams.get("uid")?.trim();
    const date = url.searchParams.get("date")?.trim();
    if (!uid) throw new HttpError(400, "Omi uid is required");
    if (!date) throw new HttpError(400, "Date is required");
    const { client } = await getLookiClientForUid(uid);
    const rawMoments = await client.listMoments(date);
    let rawForYouItems: Awaited<ReturnType<typeof client.listForYouItems>> = [];
    let forYouError: string | undefined;
    try {
      rawForYouItems = await client.listForYouItems(date);
    } catch (error) {
      forYouError =
        error instanceof Error ? error.message : "Failed to read For You";
    }
    const forYouItems = rawForYouItems.map(sanitizeForYouItem);
    const moments = attachForYouHintsToMoments(
      rawMoments.map(sanitizeMoment),
      forYouItems,
    );
    return NextResponse.json({
      moments,
      forYouItems,
      ...(forYouError ? { forYouError } : {}),
    });
  } catch (error) {
    return jsonError(error);
  }
}
