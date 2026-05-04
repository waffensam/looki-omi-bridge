import { loadEnvConfig } from "@next/env";

import { readTimeoutMs } from "@/src/server/fetch-timeout";

loadEnvConfig(process.cwd());

interface WorkerArgs {
  once: boolean;
  uid?: string;
  limit: number;
}

const args = parseArgs(process.argv.slice(2));
let stopping = false;

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

void runWorker(args).catch((error) => {
  console.error(error instanceof Error ? error.message : "worker failed");
  process.exitCode = 1;
});

async function runWorker(args: WorkerArgs): Promise<void> {
  const { processQueuedImports } = await import("@/src/server/importer");
  const intervalMs = readTimeoutMs("IMPORT_WORKER_POLL_INTERVAL_MS", 10_000);

  do {
    const result = await processQueuedImports({
      ...(args.uid ? { uid: args.uid } : {}),
      limit: args.limit,
    });
    if (result.processed > 0 || args.once) {
      console.log(
        JSON.stringify({
          processed: result.processed,
          imported: result.imported,
          skipped: result.skipped,
          failed: result.failed,
          items: result.items.map((item) => ({
            momentId: item.momentId,
            target: item.target,
            status: item.status,
            ...(item.reason ? { reason: item.reason } : {}),
          })),
        }),
      );
    }
    if (args.once || stopping) return;
    await sleep(intervalMs);
  } while (!stopping);
}

function parseArgs(raw: string[]): WorkerArgs {
  const uid = argValue(raw, "--uid");
  return {
    once: raw.includes("--once"),
    ...(uid ? { uid } : {}),
    limit: Number.parseInt(argValue(raw, "--limit") || "5", 10) || 5,
  };
}

function argValue(raw: string[], name: string): string | undefined {
  const inline = raw.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = raw.indexOf(name);
  if (index < 0) return undefined;
  return raw[index + 1];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
