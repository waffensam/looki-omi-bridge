import { NextResponse } from "next/server";

import { getRuntimeStatus } from "@/src/server/status";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(getRuntimeStatus());
}
