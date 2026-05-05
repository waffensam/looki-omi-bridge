import type {
  AppLedgerRecord,
  ImportRequest,
  ImportResult,
  ImportResultItem,
  LookiForYouItem,
  LookiMoment,
  SanitizedLookiForYouItem,
} from "@/src/app-types";
import type {
  ImportLedgerRecord,
  ImportStage,
  ImportStatus,
  ImportTarget,
} from "@/src/contracts.js";
import { sanitizeForYouItem } from "@/src/looki-for-you";
import {
  buildAsrLedgerUsage,
  currentUsageMonth,
  evaluateAsrLimits,
  summarizeMonthlyAsrUsage,
} from "./asr-usage";
import { getManagedProviderConfig } from "./config";
import { findAudioFile } from "./looki-client";
import { getLookiClientForUid } from "./looki-profile";
import { OmiIntegrationClient } from "./omi-client";
import { createAsrProvider } from "./providers/asr";
import type { AsrResult } from "./providers/types";
import { sha256 } from "./hash";
import { conversationIdempotencyKey } from "./idempotency";
import { readTimeoutMs } from "./fetch-timeout";
import { getStore } from "./store";

const ACTIVE_STATUSES = new Set<ImportStatus>(["queued", "processing"]);
const TERMINAL_STATUSES = new Set<ImportStatus>(["imported", "skipped"]);

interface OmiNativeMemorySource {
  text: string;
  textSourceSpec: string;
  sourceTextSha256: string;
  sourceTextPreview: string;
  eventDate: string;
  eventType: string;
  tags: string[];
  forYouItemIds?: string[];
}

export interface ProcessQueuedImportsOptions {
  uid?: string;
  limit?: number;
}

export interface ProcessQueuedImportsResult {
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  items: ImportResultItem[];
}

export async function importSelections(
  request: ImportRequest,
): Promise<ImportResult> {
  return enqueueImportSelections(request);
}

export async function enqueueImportSelections(
  request: ImportRequest,
): Promise<ImportResult> {
  const uid = request.uid.trim();
  if (!uid) throw new Error("Omi uid is required");
  if (!request.selections.length) return { items: [] };

  const store = getStore();
  const { client: looki } = await getLookiClientForUid(uid);
  const ledger = await store.listLedger(uid);
  const items: ImportResultItem[] = [];
  const selectedForYouItemIds = request.selections
    .filter(
      (selection) =>
        selection.importMemory &&
        (selection.sourceType || "moment") === "for_you",
    )
    .map((selection) => selection.sourceId || selection.momentId)
    .filter(isString);
  let forYouById: Map<string, LookiForYouItem> | null = null;

  for (const selection of request.selections) {
    const sourceType = selection.sourceType || "moment";
    const sourceId = selection.sourceId || selection.momentId;
    if (!sourceId) throw new Error("Import source id is required");

    if (sourceType === "for_you") {
      if (selection.importConversation) {
        items.push({
          momentId: sourceId,
          target: "conversation",
          status: "skipped",
          reason: "for_you_is_not_a_conversation_source",
        });
      }
      if (selection.importMemory) {
        if (!forYouById) {
          forYouById = new Map(
            (await looki.listForYouItems(request.date)).map((item) => [
              item.id,
              item,
            ]),
          );
        }
        const item = forYouById.get(sourceId);
        if (!item) throw new Error(`Looki For You item not found: ${sourceId}`);
        items.push(
          await enqueueForYouMemory(
            uid,
            sanitizeForYouItem(item),
            request.date,
            ledger,
          ),
        );
      }
      continue;
    }

    const moment = await looki.getMoment(sourceId);
    if (selection.importMemory) {
      items.push(
        await enqueueTarget(
          uid,
          moment,
          "memory",
          ledger,
          selectedForYouItemIds,
        ),
      );
    }
    if (selection.importConversation) {
      items.push(await enqueueTarget(uid, moment, "conversation", ledger));
    }
  }

  return { items };
}

export async function processQueuedImports(
  options: ProcessQueuedImportsOptions = {},
): Promise<ProcessQueuedImportsResult> {
  const store = getStore();
  const jobs = await store.listImportJobs({
    ...(options.uid ? { uid: options.uid } : {}),
    statuses: ["queued", "processing"],
    limit: options.limit || 10,
  });
  const staleProcessingMs = readTimeoutMs(
    "IMPORT_WORKER_STALE_PROCESSING_MS",
    30 * 60_000,
  );
  const result: ProcessQueuedImportsResult = {
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    items: [],
  };

  for (const job of jobs) {
    if (!shouldProcessJob(job, staleProcessingMs)) continue;
    const item = await processQueuedJob(job);
    result.processed += 1;
    result.items.push(item);
    if (item.status === "imported") result.imported += 1;
    if (item.status === "skipped") result.skipped += 1;
    if (item.status === "failed") result.failed += 1;
  }

  return result;
}

function shouldProcessJob(
  job: AppLedgerRecord,
  staleProcessingMs: number,
): boolean {
  if (job.record.status === "queued") return true;
  if (job.record.status !== "processing") return false;
  const updatedAt = new Date(job.record.updatedAt).getTime();
  if (Number.isNaN(updatedAt)) return true;
  return Date.now() - updatedAt > staleProcessingMs;
}

async function enqueueTarget(
  uid: string,
  moment: LookiMoment,
  target: ImportTarget,
  ledger: AppLedgerRecord[],
  contextForYouItemIds: string[] = [],
): Promise<ImportResultItem> {
  const idempotencyKey =
    target === "conversation"
      ? conversationIdempotencyKey(moment.id, moment.start_time)
      : memoryQueueIdempotencyKey(moment);
  const existing = findRelevantLedger(ledger, moment.id, target);

  if (existing && TERMINAL_STATUSES.has(existing.record.status)) {
    return {
      momentId: moment.id,
      target,
      status: "skipped",
      reason: `already_${existing.record.status}`,
      ...(existing.record.omi?.conversationId
        ? { omiId: existing.record.omi.conversationId }
        : {}),
      ...(existing.record.omi?.memoryId
        ? { omiId: existing.record.omi.memoryId }
        : {}),
    };
  }

  if (
    existing &&
    (existing.record.status === "queued" ||
      existing.record.status === "processing")
  ) {
    return {
      momentId: moment.id,
      target,
      status: existing.record.status,
      reason: existing.record.progress?.message || "already_queued",
    };
  }

  await appendLedger(
    uid,
    buildQueuedLedger(moment, idempotencyKey, target, contextForYouItemIds),
  );
  return {
    momentId: moment.id,
    target,
    status: "queued",
    reason: "queued_for_background_import",
  };
}

async function enqueueForYouMemory(
  uid: string,
  item: SanitizedLookiForYouItem,
  date: string,
  ledger: AppLedgerRecord[],
): Promise<ImportResultItem> {
  const idempotencyKey = forYouMemoryQueueIdempotencyKey(item, date);
  const existing = findRelevantLedger(ledger, item.id, "memory", "for_you");

  if (existing && TERMINAL_STATUSES.has(existing.record.status)) {
    return {
      momentId: item.id,
      target: "memory",
      status: "skipped",
      reason: `already_${existing.record.status}`,
      ...(existing.record.omi?.memoryId
        ? { omiId: existing.record.omi.memoryId }
        : {}),
    };
  }

  if (existing && ACTIVE_STATUSES.has(existing.record.status)) {
    const status =
      existing.record.status === "processing" ? "processing" : "queued";
    return {
      momentId: item.id,
      target: "memory",
      status,
      reason: existing.record.progress?.message || "already_queued",
    };
  }

  await appendLedger(uid, buildQueuedForYouLedger(item, date, idempotencyKey));
  return {
    momentId: item.id,
    target: "memory",
    status: "queued",
    reason: "queued_for_background_import",
  };
}

async function processQueuedJob(
  job: AppLedgerRecord,
): Promise<ImportResultItem> {
  const uid = job.uid;
  const momentId = job.record.looki.momentId;
  const target = job.record.target;

  try {
    await updateProgress(job, "processing", "looki", "读取 Looki moment");
    const { client: looki } = await getLookiClientForUid(uid);
    if (target === "memory" && job.record.looki.sourceType === "for_you") {
      return await processForYouMemoryJob(uid, job, looki);
    }
    const moment = await looki.getMoment(momentId);

    if (target === "memory") {
      return await processMemoryJob(uid, job, moment, looki);
    }
    return await processConversationJob(uid, job, moment, looki);
  } catch (error) {
    await appendLedger(
      uid,
      buildFailedLedger(job.record, "looki", error, job.record.createdAt),
    );
    return {
      momentId,
      target,
      status: "failed",
      reason: error instanceof Error ? error.message : "import failed",
    };
  }
}

async function processForYouMemoryJob(
  uid: string,
  job: AppLedgerRecord,
  looki: Awaited<ReturnType<typeof getLookiClientForUid>>["client"],
): Promise<ImportResultItem> {
  const omi = new OmiIntegrationClient();
  const forYouItemId =
    job.record.looki.forYouItemId || job.record.looki.momentId;
  const eventDate =
    job.record.memory?.eventDate || job.record.looki.startTime.slice(0, 10);
  let failureStage: NonNullable<ImportLedgerRecord["error"]>["stage"] = "looki";
  let itemForFailure: SanitizedLookiForYouItem | undefined;
  let sourceForFailure: OmiNativeMemorySource | undefined;

  try {
    await updateProgress(job, "processing", "looki", "读取 For You 内容");
    const item = await loadForYouItemById(looki, eventDate, forYouItemId);
    itemForFailure = item;
    const source = buildForYouNativeMemorySource(item, eventDate);
    sourceForFailure = source;

    failureStage = "omi";
    await updateProgress(
      job,
      "processing",
      "memory_write",
      "交给 Omi 原生 memory 抽取",
    );
    await omi.importMemoryText(uid, source.text, source.textSourceSpec);
    await appendLedger(
      uid,
      buildForYouNativeMemoryLedger(
        item,
        eventDate,
        source,
        "imported",
        job.record.createdAt,
        job.record.idempotencyKey,
      ),
    );
    return {
      momentId: item.id,
      target: "memory",
      status: "imported",
    };
  } catch (error) {
    const failureRecord =
      itemForFailure && sourceForFailure
        ? buildFailedLedger(
            buildForYouNativeMemoryLedger(
              itemForFailure,
              eventDate,
              sourceForFailure,
              "failed",
              job.record.createdAt,
              job.record.idempotencyKey,
            ),
            failureStage,
            error,
            job.record.createdAt,
          )
        : buildFailedLedger(
            job.record,
            failureStage,
            error,
            job.record.createdAt,
          );
    await appendLedger(uid, failureRecord);
    return {
      momentId: forYouItemId,
      target: "memory",
      status: "failed",
      reason:
        error instanceof Error ? error.message : "For You memory import failed",
    };
  }
}

async function processMemoryJob(
  uid: string,
  job: AppLedgerRecord,
  moment: LookiMoment,
  looki: Awaited<ReturnType<typeof getLookiClientForUid>>["client"],
): Promise<ImportResultItem> {
  const omi = new OmiIntegrationClient();
  let failureStage: NonNullable<ImportLedgerRecord["error"]>["stage"] =
    "memory";
  let sourceForFailure: OmiNativeMemorySource | undefined;

  try {
    await updateProgress(job, "processing", "memory_gate", "准备 Omi 记忆来源");
    const forYouHints = await loadSelectedForYouHints(
      moment.date,
      job.record.memory?.forYouItemIds || [],
      looki,
    );
    const source = buildMomentNativeMemorySource(moment, forYouHints);
    sourceForFailure = source;

    failureStage = "omi";
    await updateProgress(
      job,
      "processing",
      "memory_write",
      "交给 Omi 原生 memory 抽取",
    );
    await omi.importMemoryText(uid, source.text, source.textSourceSpec);
    await appendLedger(
      uid,
      buildNativeMemoryLedger(
        moment,
        source,
        "imported",
        job.record.createdAt,
        job.record.idempotencyKey,
      ),
    );
    return {
      momentId: moment.id,
      target: "memory",
      status: "imported",
    };
  } catch (error) {
    const failureRecord = sourceForFailure
      ? buildFailedLedger(
          buildNativeMemoryLedger(
            moment,
            sourceForFailure,
            "failed",
            job.record.createdAt,
            job.record.idempotencyKey,
          ),
          failureStage,
          error,
          job.record.createdAt,
        )
      : buildFailedLedger(
          job.record,
          failureStage,
          error,
          job.record.createdAt,
        );
    await appendLedger(uid, failureRecord);
    return {
      momentId: moment.id,
      target: "memory",
      status: "failed",
      reason: error instanceof Error ? error.message : "memory import failed",
    };
  }
}

async function processConversationJob(
  uid: string,
  job: AppLedgerRecord,
  moment: LookiMoment,
  looki: Awaited<ReturnType<typeof getLookiClientForUid>>["client"],
): Promise<ImportResultItem> {
  const asr = createAsrProvider();
  const providerConfig = getManagedProviderConfig();
  const omi = new OmiIntegrationClient();
  let failureStage: NonNullable<ImportLedgerRecord["error"]>["stage"] = "looki";
  let completedAsrResult: AsrResult | null = null;

  try {
    await updateProgress(
      job,
      "processing",
      "audio_lookup",
      "查找 Looki 音频文件",
    );
    const files = await looki.listFiles(moment.id);
    const audioFile = findAudioFile(files);
    if (!audioFile?.file?.temporary_url) {
      await appendLedger(
        uid,
        buildSkippedConversationLedger(
          job.record,
          "no_audio_file",
          job.record.createdAt,
        ),
      );
      return {
        momentId: moment.id,
        target: "conversation",
        status: "skipped",
        reason: "no_audio_file",
      };
    }

    failureStage = "asr";
    const durationMs = audioFile.file.duration_ms ?? undefined;
    const limitDecision = await evaluateConversationAsrLimits(
      uid,
      providerConfig,
      durationMs,
    );
    if (!limitDecision.allowed) {
      await appendLedger(
        uid,
        buildSkippedConversationLedger(
          job.record,
          limitDecision.message,
          job.record.createdAt,
        ),
      );
      return {
        momentId: moment.id,
        target: "conversation",
        status: "skipped",
        reason: limitDecision.reason,
      };
    }

    let audio: ArrayBuffer | null = null;
    if (asr.inputMode === "audio") {
      await updateProgress(job, "processing", "audio_download", "下载临时音频");
      audio = await looki.downloadFile(audioFile.file.temporary_url);
    }
    try {
      const asrResult = await asr.transcribeAudio({
        ...(audio ? { audio } : {}),
        audioUrl: audioFile.file.temporary_url,
        fileName: `${moment.id}.audio`,
        ...(typeof durationMs === "number" ? { durationMs } : {}),
        onProgress: async (stage, message, attempt) => {
          await updateProgress(job, "processing", stage, message, attempt);
        },
      });
      completedAsrResult = asrResult;
      if (!asrResult.transcript.text.trim()) {
        await appendLedger(
          uid,
          buildSkippedConversationLedger(
            job.record,
            "empty_transcript",
            job.record.createdAt,
            asrResult,
          ),
          { asr: asrResult.audit },
        );
        return {
          momentId: moment.id,
          target: "conversation",
          status: "skipped",
          reason: "empty_transcript",
          transcript: asrResult.transcript,
        };
      }

      failureStage = "omi";
      await updateProgress(
        job,
        "processing",
        "omi_write",
        "写入 Omi conversation",
      );
      const omiId = await omi.createConversation(
        uid,
        moment.title,
        moment.start_time,
        moment.end_time,
        asrResult.transcript,
      );
      await appendLedger(
        uid,
        buildConversationLedger(
          job.record,
          moment,
          "imported",
          omiId,
          asrResult.transcript.text,
          asrResult,
          job.record.createdAt,
        ),
        { asr: asrResult.audit },
      );
      return {
        momentId: moment.id,
        target: "conversation",
        status: "imported",
        ...(omiId ? { omiId } : {}),
        transcript: asrResult.transcript,
      };
    } finally {
      audio = null;
    }
  } catch (error) {
    await appendLedger(
      uid,
      buildFailedLedger(
        job.record,
        failureStage,
        error,
        job.record.createdAt,
        completedAsrResult,
      ),
    );
    return {
      momentId: moment.id,
      target: "conversation",
      status: "failed",
      reason:
        error instanceof Error ? error.message : "conversation import failed",
    };
  }
}

async function evaluateConversationAsrLimits(
  uid: string,
  providerConfig: ReturnType<typeof getManagedProviderConfig>,
  audioDurationMs: number | undefined,
) {
  const ledger = await getStore().listLedger(uid);
  const usage = summarizeMonthlyAsrUsage(ledger, currentUsageMonth());
  return evaluateAsrLimits({
    ...(typeof audioDurationMs === "number" ? { audioDurationMs } : {}),
    ...(typeof providerConfig.asrMaxAudioDurationMs === "number"
      ? { maxAudioDurationMs: providerConfig.asrMaxAudioDurationMs }
      : {}),
    monthlyBillableSpeechMs: usage.billableSpeechMs,
    ...(typeof providerConfig.asrMonthlyBillableLimitMs === "number"
      ? { monthlyBillableLimitMs: providerConfig.asrMonthlyBillableLimitMs }
      : {}),
  });
}

async function loadSelectedForYouHints(
  date: string,
  itemIds: string[],
  looki: Awaited<ReturnType<typeof getLookiClientForUid>>["client"],
) {
  if (itemIds.length === 0) return [];
  try {
    const selectedIds = new Set(itemIds);
    return (await looki.listForYouItems(date))
      .map(sanitizeForYouItem)
      .filter((item) => selectedIds.has(item.id))
      .map((item) => ({
        ...item,
        score: 1,
        matchReason: "text" as const,
        role: "memory_evidence" as const,
      }));
  } catch {
    return [];
  }
}

function buildQueuedLedger(
  moment: LookiMoment,
  idempotencyKey: string,
  target: ImportTarget,
  contextForYouItemIds: string[] = [],
): ImportLedgerRecord {
  const now = new Date().toISOString();
  return {
    idempotencyKey,
    target,
    status: "queued",
    decision: "import",
    looki: buildLookiLedger(moment),
    ...(target === "memory" && contextForYouItemIds.length > 0
      ? { memory: { forYouItemIds: contextForYouItemIds } }
      : {}),
    progress: {
      stage: "queued",
      message: "等待后台 worker 处理",
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function buildQueuedForYouLedger(
  item: SanitizedLookiForYouItem,
  date: string,
  idempotencyKey: string,
): ImportLedgerRecord {
  const now = new Date().toISOString();
  const recordedAt = safeDateTime(item.recordedAt, date);
  return {
    idempotencyKey,
    target: "memory",
    status: "queued",
    decision: "import",
    looki: {
      sourceType: "for_you",
      momentId: item.id,
      forYouItemId: item.id,
      title: item.title,
      startTime: recordedAt,
      endTime: recordedAt,
      mediaTypes: item.mediaTypes,
    },
    memory: {
      eventDate: date,
      forYouItemIds: [item.id],
    },
    progress: {
      stage: "queued",
      message: "等待后台 worker 处理",
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function buildMomentNativeMemorySource(
  moment: LookiMoment,
  forYouHints: Awaited<ReturnType<typeof loadSelectedForYouHints>>,
): OmiNativeMemorySource {
  const text = compactLines([
    `标题：${moment.title}`,
    moment.description ? `摘要：${moment.description}` : "",
    ...forYouHints.flatMap((item) => [
      `精选标题：${item.title}`,
      item.description ? `精选摘要：${item.description}` : "",
      item.content ? `精选内容：${item.content}` : "",
    ]),
  ]);
  const tags = uniqueStrings([
    "looki",
    "looki_daily",
    `looki_${moment.date.replaceAll("-", "_")}`,
    "omi_native_extract",
  ]);
  return buildNativeMemorySource({
    text,
    textSourceSpec: `looki:${moment.date}:moment:${moment.id}`,
    eventDate: moment.date,
    eventType: "omi_native_extract",
    tags,
    forYouItemIds: forYouHints.map((item) => item.id),
  });
}

function buildForYouNativeMemorySource(
  item: SanitizedLookiForYouItem,
  date: string,
): OmiNativeMemorySource {
  const text = compactLines([
    `标题：${item.title}`,
    item.description ? `摘要：${item.description}` : "",
    item.content ? `内容：${item.content}` : "",
  ]);
  const tags = uniqueStrings([
    "looki",
    "looki_daily",
    `looki_${date.replaceAll("-", "_")}`,
    "looki_for_you",
    "omi_native_extract",
  ]);
  return buildNativeMemorySource({
    text,
    textSourceSpec: `looki:${date}:for_you:${item.id}`,
    eventDate: date,
    eventType: "omi_native_extract",
    tags,
    forYouItemIds: [item.id],
  });
}

function buildNativeMemorySource(input: {
  text: string;
  textSourceSpec: string;
  eventDate: string;
  eventType: string;
  tags: string[];
  forYouItemIds?: string[];
}): OmiNativeMemorySource {
  const text = input.text.trim();
  return {
    text,
    textSourceSpec: input.textSourceSpec,
    sourceTextSha256: sha256(text),
    sourceTextPreview: text.slice(0, 180),
    eventDate: input.eventDate,
    eventType: input.eventType,
    tags: input.tags,
    ...(input.forYouItemIds?.length
      ? { forYouItemIds: input.forYouItemIds }
      : {}),
  };
}

function buildNativeMemoryLedger(
  moment: LookiMoment,
  source: OmiNativeMemorySource,
  status: ImportStatus,
  createdAt?: string,
  idempotencyKey = source.textSourceSpec,
): ImportLedgerRecord {
  const now = new Date().toISOString();
  return {
    idempotencyKey,
    target: "memory",
    status,
    decision: "import",
    looki: buildLookiLedger(moment),
    memory: buildNativeMemoryMetadata(source),
    omi: {
      method: "memory_native_extract",
      source: "looki",
    },
    progress: {
      stage: "done",
      message:
        status === "imported"
          ? "Omi native memory extraction 已提交"
          : "Omi native memory extraction 失败",
      updatedAt: now,
    },
    createdAt: createdAt || now,
    updatedAt: now,
  };
}

function buildForYouNativeMemoryLedger(
  item: SanitizedLookiForYouItem,
  date: string,
  source: OmiNativeMemorySource,
  status: ImportStatus,
  createdAt?: string,
  idempotencyKey = source.textSourceSpec,
): ImportLedgerRecord {
  const now = new Date().toISOString();
  const recordedAt = safeDateTime(item.recordedAt, date);
  return {
    idempotencyKey,
    target: "memory",
    status,
    decision: "import",
    looki: {
      sourceType: "for_you",
      momentId: item.id,
      forYouItemId: item.id,
      title: item.title,
      startTime: recordedAt,
      endTime: recordedAt,
      mediaTypes: item.mediaTypes,
    },
    memory: buildNativeMemoryMetadata(source),
    omi: {
      method: "memory_native_extract",
      source: "looki",
    },
    progress: {
      stage: "done",
      message:
        status === "imported"
          ? "Omi native memory extraction 已提交"
          : "Omi native memory extraction 失败",
      updatedAt: now,
    },
    createdAt: createdAt || now,
    updatedAt: now,
  };
}

function buildNativeMemoryMetadata(
  source: OmiNativeMemorySource,
): NonNullable<ImportLedgerRecord["memory"]> {
  return {
    extractionMode: "omi_native",
    sourceTextPreview: source.sourceTextPreview,
    sourceTextSha256: source.sourceTextSha256,
    eventDate: source.eventDate,
    eventType: source.eventType,
    tags: source.tags,
    ...(source.forYouItemIds?.length
      ? { forYouItemIds: source.forYouItemIds }
      : {}),
  };
}

function buildConversationLedger(
  existing: ImportLedgerRecord,
  moment: LookiMoment,
  status: ImportStatus,
  conversationId: string | undefined,
  transcriptText: string,
  asrResult: AsrResult,
  createdAt?: string,
): ImportLedgerRecord {
  const now = new Date().toISOString();
  return {
    idempotencyKey: existing.idempotencyKey,
    target: "conversation",
    status,
    decision: status === "imported" ? "import" : "skip",
    looki: buildLookiLedger(moment),
    asr: buildAsrLedgerUsage(asrResult, sha256(transcriptText)),
    omi: {
      ...(conversationId ? { conversationId } : {}),
      method: "text_fallback",
      source: "unknown",
    },
    progress: {
      stage: "done",
      message: "Omi conversation 已写入",
      updatedAt: now,
    },
    createdAt: createdAt || now,
    updatedAt: now,
  };
}

function buildSkippedConversationLedger(
  existing: ImportLedgerRecord,
  reason: string,
  createdAt?: string,
  asrResult?: AsrResult,
): ImportLedgerRecord {
  const now = new Date().toISOString();
  const transcriptText = asrResult?.transcript.text || "";
  return {
    ...existing,
    status: "skipped",
    decision: "skip",
    ...(asrResult
      ? {
          asr: buildAsrLedgerUsage(asrResult, sha256(transcriptText)),
        }
      : {}),
    error: {
      stage: "normalize",
      message: reason,
      retryable: false,
    },
    progress: {
      stage: "done",
      message: reason,
      updatedAt: now,
    },
    createdAt: createdAt || existing.createdAt,
    updatedAt: now,
  };
}

function buildFailedLedger(
  existing: ImportLedgerRecord,
  stage: NonNullable<ImportLedgerRecord["error"]>["stage"],
  error: unknown,
  createdAt?: string,
  asrResult?: AsrResult | null,
): ImportLedgerRecord {
  const now = new Date().toISOString();
  const transcriptText = asrResult?.transcript.text || "";
  return {
    ...existing,
    status: "failed",
    decision: "import",
    ...(asrResult
      ? {
          asr: buildAsrLedgerUsage(asrResult, sha256(transcriptText)),
        }
      : {}),
    error: {
      stage,
      message: error instanceof Error ? error.message : "Import failed",
      retryable: true,
    },
    progress: {
      stage: stageToProgress(stage),
      message: error instanceof Error ? error.message : "Import failed",
      updatedAt: now,
    },
    createdAt: createdAt || existing.createdAt,
    updatedAt: now,
  };
}

function buildLookiLedger(moment: LookiMoment): ImportLedgerRecord["looki"] {
  return {
    momentId: moment.id,
    title: moment.title,
    startTime: moment.start_time,
    endTime: moment.end_time,
    mediaTypes: moment.media_types,
  };
}

async function updateProgress(
  job: AppLedgerRecord,
  status: ImportStatus,
  stage: ImportStage,
  message: string,
  attempt?: number,
): Promise<void> {
  const now = new Date().toISOString();
  await appendLedger(job.uid, {
    ...job.record,
    status,
    progress: {
      stage,
      message,
      ...(typeof attempt === "number" ? { attempt } : {}),
      updatedAt: now,
    },
    updatedAt: now,
  });
}

async function appendLedger(
  uid: string,
  record: ImportLedgerRecord,
  provider?: AppLedgerRecord["provider"],
): Promise<void> {
  await getStore().appendLedger({
    uid,
    record,
    ...(provider ? { provider } : {}),
  });
}

function findRelevantLedger(
  ledger: AppLedgerRecord[],
  sourceId: string,
  target: ImportTarget,
  sourceType: "moment" | "for_you" = "moment",
): AppLedgerRecord | null {
  return (
    ledger
      .filter(
        (entry) =>
          entry.record.target === target &&
          (entry.record.looki.sourceType || "moment") === sourceType &&
          (sourceType === "for_you"
            ? entry.record.looki.forYouItemId || entry.record.looki.momentId
            : entry.record.looki.momentId) === sourceId,
      )
      .sort((a, b) =>
        b.record.updatedAt.localeCompare(a.record.updatedAt),
      )[0] || null
  );
}

function memoryQueueIdempotencyKey(moment: LookiMoment): string {
  return `looki:memory:${moment.date}:${moment.id}:${moment.start_time}`;
}

function forYouMemoryQueueIdempotencyKey(
  item: SanitizedLookiForYouItem,
  date: string,
): string {
  return `looki:memory:${date}:for_you:${item.id}`;
}

async function loadForYouItemById(
  looki: Awaited<ReturnType<typeof getLookiClientForUid>>["client"],
  date: string,
  itemId: string,
): Promise<SanitizedLookiForYouItem> {
  const item = (await looki.listForYouItems(date))
    .map(sanitizeForYouItem)
    .find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Looki For You item not found: ${itemId}`);
  return item;
}

function syntheticMomentFromForYou(
  item: SanitizedLookiForYouItem,
  date: string,
): LookiMoment {
  const recordedAt = safeDateTime(item.recordedAt, date);
  return {
    id: item.id,
    title: item.title,
    ...(item.description || item.content
      ? { description: item.description || item.content }
      : {}),
    media_types: item.mediaTypes,
    cover_file: null,
    date,
    tz: timezoneOffsetFromIso(recordedAt),
    start_time: recordedAt,
    end_time: recordedAt,
  };
}

function safeDateTime(value: string, fallbackDate: string): string {
  if (!Number.isNaN(Date.parse(value))) return value;
  return `${fallbackDate}T00:00:00.000+08:00`;
}

function timezoneOffsetFromIso(value: string): string {
  const match = value.match(/([+-]\d{2}:\d{2})$/);
  return match?.[1] || "+08:00";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function compactLines(values: string[]): string {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");
}

function stageToProgress(
  stage: NonNullable<ImportLedgerRecord["error"]>["stage"],
): ImportStage {
  if (stage === "looki") return "looki";
  if (stage === "asr") return "asr_upload";
  if (stage === "memory") return "memory_gate";
  if (stage === "omi") return "omi_write";
  if (stage === "ledger") return "ledger";
  return "done";
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
