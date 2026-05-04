import { NextResponse } from "next/server";

import { getPublicProfile } from "@/src/server/looki-profile";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const uid = new URL(request.url).searchParams.get("uid")?.trim();
  if (!uid) {
    return NextResponse.json({ is_setup_completed: false });
  }

  const profile = await getPublicProfile(uid);
  return NextResponse.json({
    is_setup_completed: Boolean(profile?.configured),
  });
}
