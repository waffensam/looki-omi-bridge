import type {
  AppLedgerRecord,
  ImportRequest,
  ImportResult,
  ImportResultItem,
  LookiMoment,
} from "@/src/app-types";
import type {
  ImportLedgerRecord,
  ImportStatus,
  ImportTarget,
  LookiMemoryCandidate,
} from "@/src/contracts.js";
import { shouldWriteMemory } from "@/src/memory";
import { findAudioFile } from "./looki-client";
import { getLookiClientForUid } from "./looki-profile";
import { OmiIntegrationClient } from "./omi-client";
import { ManagedMemoryGateProvider } from "./providers/memory-gate";
import { XfyunAsrProvider } from "./providers/xfyun-asr";
import { sha256 } from "./hash";
import { conversationIdempotencyKey } from "./idempotency";
import { getStore } from "./store";

export async function importSelections(
  request: ImportRequest,
): Promise<ImportResult> {
  const uid = request.uid.trim();
  if (!uid) throw new Error("Omi uid is required");
  if (!request.selections.length) return { items: [] };

  const store = getStore();
  const { client: looki } = await getLookiClientForUid(uid);
  const omi = new OmiIntegrationClient();
  const memoryGate = new ManagedMemoryGateProvider();
  const asr = new XfyunAsrProvider();
  const ledger = await store.listLedger(uid);
  const existingMemoryContents = ledger
    .map((entry) => entry.record.memory?.content)
    .filter(isString);
  const items: ImportResultItem[] = [];

  for (const selection of request.selections) {
    const moment = await looki.getMoment(selection.momentId);
    if (selection.importMemory) {
      items.push(
        await importMemoryForMoment(
          uid,
          moment,
          existingMemoryContents,
          memoryGate,
          omi,
        ),
      );
    }
    if (selection.importConversation) {
      items.push(
        await importConversationForMoment(uid, moment, looki, asr, omi),
      );
    }
  }

  return { items };
}

async function importMemoryForMoment(
  uid: string,
  moment: LookiMoment,
  existingMemoryContents: string[],
  memoryGate: ManagedMemoryGateProvider,
  omi: OmiIntegrationClient,
): Promise<ImportResultItem> {
  const fallbackKey = `looki:memory:${moment.date}:unknown:${moment.id}`;

  try {
    const { candidate, audit } = await memoryGate.buildCandidate(
      moment,
      existingMemoryContents,
    );
    const existing = await getStore().findLedger(uid, candidate.idempotencyKey);
    if (existing?.record.status === "imported") {
      return {
        momentId: moment.id,
        target: "memory",
        status: "skipped",
        reason: "already_imported",
        ...(existing.record.omi?.memoryId
          ? { omiId: existing.record.omi.memoryId }
          : {}),
        candidate,
      };
    }

    if (!shouldWriteMemory(candidate.writePolicy)) {
      await appendLedger(
        uid,
        buildMemoryLedger(
          moment,
          candidate,
          "skipped",
          undefined,
          existing?.record.createdAt,
        ),
        {
          memoryGate: audit,
        },
      );
      return {
        momentId: moment.id,
        target: "memory",
        status: "skipped",
        reason: candidate.writePolicy,
        candidate,
      };
    }

    const omiId = await omi.createMemory(uid, candidate);
    await appendLedger(
      uid,
      buildMemoryLedger(
        moment,
        candidate,
        "imported",
        omiId,
        existing?.record.createdAt,
      ),
      {
        memoryGate: audit,
      },
    );
    return {
      momentId: moment.id,
      target: "memory",
      status: "imported",
      ...(omiId ? { omiId } : {}),
      candidate,
    };
  } catch (error) {
    await appendLedger(
      uid,
      buildFailedLedger(moment, fallbackKey, "memory", "memory", error),
    );
    return {
      momentId: moment.id,
      target: "memory",
      status: "failed",
      reason: error instanceof Error ? error.message : "memory import failed",
    };
  }
}

async function importConversationForMoment(
  uid: string,
  moment: LookiMoment,
  looki: Awaited<ReturnType<typeof getLookiClientForUid>>["client"],
  asr: XfyunAsrProvider,
  omi: OmiIntegrationClient,
): Promise<ImportResultItem> {
  const idempotencyKey = conversationIdempotencyKey(
    moment.id,
    moment.start_time,
  );
  const existing = await getStore().findLedger(uid, idempotencyKey);
  if (existing?.record.status === "imported") {
    return {
      momentId: moment.id,
      target: "conversation",
      status: "skipped",
      reason: "already_imported",
      ...(existing.record.omi?.conversationId
        ? { omiId: existing.record.omi.conversationId }
        : {}),
    };
  }

  try {
    const files = await looki.listFiles(moment.id);
    const audioFile = findAudioFile(files);
    if (!audioFile?.file?.temporary_url) {
      await appendLedger(
        uid,
        buildSkippedConversationLedger(
          moment,
          idempotencyKey,
          "no_audio_file",
          existing?.record.createdAt,
        ),
      );
      return {
        momentId: moment.id,
        target: "conversation",
        status: "skipped",
        reason: "no_audio_file",
      };
    }

    let audio: ArrayBuffer | null = await looki.downloadFile(
      audioFile.file.temporary_url,
    );
    const durationMs = audioFile.file.duration_ms ?? undefined;
    try {
      const asrResult = await asr.transcribeAudio({
        audio,
        fileName: `${moment.id}.audio`,
        ...(typeof durationMs === "number" ? { durationMs } : {}),
      });
      if (!asrResult.transcript.text.trim()) {
        await appendLedger(
          uid,
          buildSkippedConversationLedger(
            moment,
            idempotencyKey,
            "empty_transcript",
            existing?.record.createdAt,
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
          moment,
          idempotencyKey,
          "imported",
          omiId,
          asrResult.transcript.text,
          existing?.record.createdAt,
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
      buildFailedLedger(moment, idempotencyKey, "conversation", "asr", error),
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

function buildMemoryLedger(
  moment: LookiMoment,
  candidate: LookiMemoryCandidate,
  status: ImportStatus,
  memoryId?: string,
  createdAt?: string,
): ImportLedgerRecord {
  const now = new Date().toISOString();
  return {
    idempotencyKey: candidate.idempotencyKey,
    target: "memory",
    status,
    decision:
      status === "imported"
        ? "import"
        : candidate.writePolicy === "stage_only"
          ? "review"
          : "skip",
    looki: buildLookiLedger(moment),
    memory: {
      content: candidate.content,
      writePolicy: candidate.writePolicy,
      evidenceDepth: candidate.evidenceDepth,
      confidence: candidate.confidence,
      eventDate: candidate.eventDate,
      eventType: candidate.eventType,
      tags: candidate.tags,
    },
    omi: {
      ...(memoryId ? { memoryId } : {}),
      method: "memory_create",
      source: "looki",
    },
    createdAt: createdAt || now,
    updatedAt: now,
  };
}

function buildConversationLedger(
  moment: LookiMoment,
  idempotencyKey: string,
  status: ImportStatus,
  conversationId: string | undefined,
  transcriptText: string,
  createdAt?: string,
): ImportLedgerRecord {
  const now = new Date().toISOString();
  return {
    idempotencyKey,
    target: "conversation",
    status,
    decision: status === "imported" ? "import" : "skip",
    looki: buildLookiLedger(moment),
    asr: {
      provider: "xfyun",
      transcriptSha256: sha256(transcriptText),
    },
    omi: {
      ...(conversationId ? { conversationId } : {}),
      method: "text_fallback",
      source: "unknown",
    },
    createdAt: createdAt || now,
    updatedAt: now,
  };
}

function buildSkippedConversationLedger(
  moment: LookiMoment,
  idempotencyKey: string,
  reason: string,
  createdAt?: string,
): ImportLedgerRecord {
  const now = new Date().toISOString();
  return {
    idempotencyKey,
    target: "conversation",
    status: "skipped",
    decision: "skip",
    looki: buildLookiLedger(moment),
    error: {
      stage: "normalize",
      message: reason,
      retryable: false,
    },
    createdAt: createdAt || now,
    updatedAt: now,
  };
}

function buildFailedLedger(
  moment: LookiMoment,
  idempotencyKey: string,
  target: ImportTarget,
  stage: NonNullable<ImportLedgerRecord["error"]>["stage"],
  error: unknown,
): ImportLedgerRecord {
  const now = new Date().toISOString();
  return {
    idempotencyKey,
    target,
    status: "failed",
    decision: "import",
    looki: buildLookiLedger(moment),
    error: {
      stage,
      message: error instanceof Error ? error.message : "Import failed",
      retryable: true,
    },
    createdAt: now,
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

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
