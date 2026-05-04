import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { jsonError } from "@/src/server/api-response";
import { getOmiOAuthConfig } from "@/src/server/config";
import { OAUTH_STATE_COOKIE } from "@/src/server/oauth";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const config = getOmiOAuthConfig();
    const state = randomBytes(32).toString("hex");
    const url = new URL("https://api.omi.me/v1/oauth/authorize");
    url.searchParams.set("app_id", config.appId);
    url.searchParams.set("state", state);

    const response = NextResponse.redirect(url);
    response.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.callbackUrl.startsWith("https://"),
      maxAge: 10 * 60,
      path: "/",
    });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
