import { NextResponse } from "next/server";

import { jsonError } from "@/src/server/api-response";
import { getBaseUrl } from "@/src/server/config";
import { HttpError } from "@/src/server/errors";
import { OAUTH_STATE_COOKIE } from "@/src/server/oauth";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const uid = url.searchParams.get("uid")?.trim();
    const state = url.searchParams.get("state")?.trim();
    const expectedState = readCookie(request, OAUTH_STATE_COOKIE);

    if (!uid) throw new HttpError(400, "Missing Omi uid");
    if (!state || !expectedState || state !== expectedState) {
      throw new HttpError(400, "Invalid OAuth state");
    }

    const redirectUrl = new URL(getBaseUrl());
    redirectUrl.searchParams.set("uid", uid);
    redirectUrl.searchParams.set("omi_connected", "1");
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set(OAUTH_STATE_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}

function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  for (const cookie of cookies) {
    const [key, ...value] = cookie.split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}
