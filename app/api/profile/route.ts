import { NextResponse } from "next/server";

import type { ProviderMode } from "@/src/app-types";
import { jsonError } from "@/src/server/api-response";
import { HttpError } from "@/src/server/errors";
import { getPublicProfile, saveLookiProfile } from "@/src/server/looki-profile";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const uid = new URL(request.url).searchParams.get("uid")?.trim();
    if (!uid) throw new HttpError(400, "Omi uid is required");
    const profile = await getPublicProfile(uid);
    return NextResponse.json({ profile });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      uid?: string;
      lookiBaseUrl?: string;
      lookiApiKey?: string;
      providerMode?: ProviderMode;
    };
    const profile = await saveLookiProfile({
      uid: body.uid || "",
      lookiBaseUrl: body.lookiBaseUrl || "",
      ...(body.lookiApiKey ? { lookiApiKey: body.lookiApiKey } : {}),
      ...(body.providerMode ? { providerMode: body.providerMode } : {}),
    });
    return NextResponse.json({ profile });
  } catch (error) {
    return jsonError(error);
  }
}
