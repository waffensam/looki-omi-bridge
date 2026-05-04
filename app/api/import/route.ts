import { NextResponse } from "next/server";

import type { ImportRequest } from "@/src/app-types";
import { jsonError } from "@/src/server/api-response";
import { importSelections } from "@/src/server/importer";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as ImportRequest;
    const result = await importSelections(body);
    return NextResponse.json({ result });
  } catch (error) {
    return jsonError(error);
  }
}
