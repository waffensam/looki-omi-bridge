import { NextResponse } from "next/server";
import { start } from "workflow/api";

import type { ImportRequest } from "@/src/app-types";
import { jsonError } from "@/src/server/api-response";
import { importSelections } from "@/src/server/importer";
import { processImportQueueWorkflow } from "@/workflows/import-queue";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as ImportRequest;
    const result = await importSelections(body);
    const queuedCount = result.items.filter(
      (item) => item.status === "queued" || item.status === "processing",
    ).length;
    let workflowRunId: string | undefined;
    let workflowTriggerError: string | undefined;
    if (queuedCount > 0) {
      try {
        const run = await start(processImportQueueWorkflow, [
          {
            uid: body.uid.trim(),
            limit: queuedCount,
          },
        ]);
        workflowRunId = run.runId;
      } catch (error) {
        workflowTriggerError =
          error instanceof Error ? error.message : "workflow start failed";
      }
    }

    return NextResponse.json({
      result,
      ...(workflowRunId ? { workflowRunId } : {}),
      ...(workflowTriggerError ? { workflowTriggerError } : {}),
    });
  } catch (error) {
    return jsonError(error);
  }
}
