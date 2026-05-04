import type { ProcessQueuedImportsResult } from "@/src/server/importer";

export interface ImportQueueWorkflowInput {
  uid?: string;
  limit?: number;
}

export async function processImportQueueWorkflow(
  input: ImportQueueWorkflowInput,
): Promise<ProcessQueuedImportsResult> {
  "use workflow";

  return processImportQueueStep(input);
}

async function processImportQueueStep(
  input: ImportQueueWorkflowInput,
): Promise<ProcessQueuedImportsResult> {
  "use step";

  const { processQueuedImports } = await import("@/src/server/importer");
  return processQueuedImports({
    ...(input.uid ? { uid: input.uid } : {}),
    limit: input.limit || 1,
  });
}
