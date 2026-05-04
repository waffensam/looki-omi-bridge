import { NextResponse } from "next/server";

import { getRuntimeStatus } from "@/src/server/status";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    service: "looki-omi-bridge",
    status: getRuntimeStatus(),
    checkedAt: new Date().toISOString(),
  });
}
