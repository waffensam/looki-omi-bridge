import type { AppLedgerRecord } from "@/src/app-types";
import type { ImportLedgerRecord } from "@/src/contracts";
import type { AsrResult } from "./providers/types";

const BAILIAN_RECORDED_ASR_PRICE_USD_PER_SECOND: Record<string, number> = {
  "paraformer-v2": 0.000012,
  "paraformer-8k-v2": 0.000012,
};

export interface MonthlyAsrUsageSummary {
  month: string;
  asrRunCount: number;
  originalDurationMs: number;
  billableSpeechMs: number;
  estimatedCostUsd: number;
}

export function buildAsrLedgerUsage(
  asrResult: AsrResult,
  transcriptSha256: string,
): NonNullable<ImportLedgerRecord["asr"]> {
  const provider = asrResult.audit.provider;
  const model = asrResult.audit.model;
  const billing = estimateAsrCostUsd(
    provider,
    model,
    asrResult.transcript.billableSpeechMs,
  );
  return {
    provider,
    ...(model ? { model } : {}),
    ...(asrResult.audit.requestId
      ? { orderId: asrResult.audit.requestId }
      : {}),
    transcriptSha256,
    ...(typeof asrResult.transcript.originalDurationMs === "number"
      ? { originalDurationMs: asrResult.transcript.originalDurationMs }
      : {}),
    ...(typeof asrResult.transcript.billableSpeechMs === "number"
      ? { billableSpeechMs: asrResult.transcript.billableSpeechMs }
      : {}),
    ...(billing ? billing : {}),
  };
}

export function summarizeMonthlyAsrUsage(
  ledger: AppLedgerRecord[],
  month = currentUsageMonth(),
): MonthlyAsrUsageSummary {
  const summary: MonthlyAsrUsageSummary = {
    month,
    asrRunCount: 0,
    originalDurationMs: 0,
    billableSpeechMs: 0,
    estimatedCostUsd: 0,
  };

  for (const entry of ledger) {
    const record = entry.record;
    if (!record.asr || !record.updatedAt.startsWith(month)) continue;
    summary.asrRunCount += 1;
    summary.originalDurationMs += record.asr.originalDurationMs || 0;
    summary.billableSpeechMs += record.asr.billableSpeechMs || 0;
    summary.estimatedCostUsd += record.asr.estimatedCostUsd || 0;
  }

  summary.estimatedCostUsd = roundUsd(summary.estimatedCostUsd);
  return summary;
}

export function currentUsageMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

function estimateAsrCostUsd(
  provider: string,
  model: string | undefined,
  billableSpeechMs: number | undefined,
):
  | {
      estimatedCostUsd: number;
      billingUnitPriceUsdPerSecond: number;
    }
  | undefined {
  if (typeof billableSpeechMs !== "number" || billableSpeechMs <= 0) {
    return undefined;
  }
  if (!isBailianProvider(provider) || !model) return undefined;
  const unitPrice = BAILIAN_RECORDED_ASR_PRICE_USD_PER_SECOND[model];
  if (typeof unitPrice !== "number") return undefined;
  return {
    estimatedCostUsd: roundUsd((billableSpeechMs / 1000) * unitPrice),
    billingUnitPriceUsdPerSecond: unitPrice,
  };
}

function isBailianProvider(provider: string): boolean {
  const normalized = provider.toLowerCase();
  return normalized === "bailian" || normalized === "dashscope";
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
