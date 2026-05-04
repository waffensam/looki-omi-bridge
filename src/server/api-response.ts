import { NextResponse } from "next/server";

import { HttpError, errorMessage } from "./errors";

export function jsonError(error: unknown): NextResponse {
  const status = error instanceof HttpError ? error.status : 500;
  return NextResponse.json({ error: errorMessage(error) }, { status });
}
