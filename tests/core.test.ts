import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { AppLedgerRecord } from "@/src/app-types";
import type { ImportStatus, LookiMemoryCandidate } from "@/src/contracts";
import {
  attachForYouHints,
  attachForYouHintsToMoments,
  sanitizeForYouItem,
} from "@/src/looki-for-you";
import {
  buildOmiIntegrationMemoryImportPayload,
  buildOmiIntegrationMemoryTextPayload,
  buildOmiMemoryCreatePayload,
  contentLooksNarrativeSummary,
} from "@/src/memory";
import {
  conversationIdempotencyKey,
  memoryIdempotencyKey,
} from "@/src/server/idempotency";
import {
  buildAsrLedgerUsage,
  evaluateAsrLimits,
  summarizeMonthlyAsrUsage,
} from "@/src/server/asr-usage";
import { normalizeBailianTranscriptionResult } from "@/src/server/providers/bailian-asr";
import { buildXfyunSignedRequest } from "@/src/server/providers/xfyun-asr";
import { joinUrl } from "@/src/server/url";

describe("joinUrl", () => {
  it("preserves base API paths", () => {
    assert.equal(
      joinUrl("https://open.looki.ai/api/v1", "/moments").toString(),
      "https://open.looki.ai/api/v1/moments",
    );
  });

  it("handles root API hosts", () => {
    assert.equal(
      joinUrl("https://api.omi.me", "/v2/integrations/app").toString(),
      "https://api.omi.me/v2/integrations/app",
    );
  });
});

describe("ASR limit controls", () => {
  it("blocks audio that would exceed configured ASR limits", () => {
    assert.deepEqual(
      evaluateAsrLimits({
        audioDurationMs: 121 * 60_000,
        maxAudioDurationMs: 120 * 60_000,
        monthlyBillableSpeechMs: 0,
      }),
      {
        allowed: false,
        reason: "audio_duration_exceeds_limit",
        message: "audio_duration_exceeds_limit:121m>120m",
      },
    );

    assert.deepEqual(
      evaluateAsrLimits({
        monthlyBillableSpeechMs: 600 * 60_000,
        monthlyBillableLimitMs: 600 * 60_000,
      }),
      {
        allowed: false,
        reason: "monthly_asr_limit_reached",
        message: "monthly_asr_limit_reached:600m>=600m",
      },
    );
  });
});

describe("idempotency keys", () => {
  it("uses stable moment id and start time for conversations", () => {
    assert.equal(
      conversationIdempotencyKey("moment-1", "2026-05-04T08:30:00+08:00"),
      "looki:conversation:moment-1:2026-05-04T08:30:00+08:00",
    );
  });

  it("does not depend on mutable title text for memories", () => {
    assert.equal(
      memoryIdempotencyKey("2026-05-04", "family_milestone", "moment-1"),
      "looki:memory:2026-05-04:family_milestone:moment-1",
    );
  });
});

describe("XFYun signing", () => {
  it("returns signature for request headers instead of query params", () => {
    const request = buildXfyunSignedRequest(
      "https://office-api-ist-dx.iflyaisol.com",
      "/v2/upload",
      {
        appId: "app",
        accessKeyId: "key",
        dateTime: "2026-05-04T22:00:00+0800",
        signatureRandom: "abc123abc123abcd",
        fileSize: 123,
        fileName: "sample.m4a",
        duration: 1000,
        language: "autodialect",
      },
      "secret",
    );

    assert.ok(request.signature.length > 0);
    assert.equal(request.url.searchParams.has("signature"), false);
    assert.equal(
      request.url.searchParams.get("signatureRandom"),
      "abc123abc123abcd",
    );
  });
});

describe("Bailian ASR normalization", () => {
  it("normalizes sentence timestamps and speaker labels", () => {
    const transcript = normalizeBailianTranscriptionResult(
      {
        properties: {
          original_duration_in_milliseconds: 60000,
        },
        transcripts: [
          {
            channel_id: 0,
            content_duration_in_milliseconds: 4200,
            text: "提醒我明天买咖啡。",
            sentences: [
              {
                begin_time: 12000,
                end_time: 16200,
                text: "提醒我明天买咖啡。",
                speaker_id: 2,
              },
            ],
          },
        ],
      },
      "task-1",
    );

    assert.equal(transcript.provider, "bailian");
    assert.equal(transcript.providerOrderId, "task-1");
    assert.equal(transcript.originalDurationMs, 60000);
    assert.equal(transcript.billableSpeechMs, 4200);
    assert.equal(transcript.text, "提醒我明天买咖啡。");
    assert.deepEqual(transcript.segments, [
      {
        text: "提醒我明天买咖啡。",
        speaker: "SPEAKER_02",
        isUser: false,
        start: 12,
        end: 16.2,
      },
    ]);
  });
});

describe("ASR usage accounting", () => {
  it("records billable speech duration and monthly estimated cost", () => {
    const transcript = normalizeBailianTranscriptionResult(
      {
        properties: {
          original_duration_in_milliseconds: 60000,
        },
        transcripts: [
          {
            content_duration_in_milliseconds: 4200,
            text: "提醒我明天买咖啡。",
            sentences: [
              {
                begin_time: 12000,
                end_time: 16200,
                text: "提醒我明天买咖啡。",
              },
            ],
          },
        ],
      },
      "task-1",
    );
    const transcriptSha256 = "a".repeat(64);
    const asr = buildAsrLedgerUsage(
      {
        transcript,
        audit: {
          provider: "bailian",
          model: "paraformer-v2",
          requestId: "task-1",
        },
      },
      transcriptSha256,
    );

    assert.deepEqual(asr, {
      provider: "bailian",
      model: "paraformer-v2",
      orderId: "task-1",
      transcriptSha256,
      originalDurationMs: 60000,
      billableSpeechMs: 4200,
      estimatedCostUsd: 0.00005,
      billingUnitPriceUsdPerSecond: 0.000012,
    });

    const summary = summarizeMonthlyAsrUsage(
      [
        {
          uid: "user-1",
          record: {
            idempotencyKey: "looki:conversation:moment-1:start",
            target: "conversation",
            status: "imported",
            looki: {
              momentId: "moment-1",
              startTime: "2026-05-04T11:03:49.746Z",
              endTime: "2026-05-04T11:25:13.148Z",
            },
            asr,
            createdAt: "2026-05-05T05:34:21.248Z",
            updatedAt: "2026-05-05T05:34:21.248Z",
          },
        },
      ],
      "2026-05",
    );

    assert.deepEqual(summary, {
      month: "2026-05",
      asrRunCount: 1,
      originalDurationMs: 60000,
      billableSpeechMs: 4200,
      estimatedCostUsd: 0.00005,
    });
  });
});

describe("Looki For You enrichment", () => {
  it("strips signed media URLs from For You content", () => {
    const item = sanitizeForYouItem({
      id: "for-you-1",
      type: "IMAGE_POST",
      title: "迪卡侬亲子选车",
      description: "孩子期待新车",
      content:
        "洞察 ![devo-user-image](https://user.file.devo.looki.ai/signed.jpg?x-looki-token=secret) 店内调试自行车",
      created_at: "2026-05-04T03:54:20+08:00",
      recorded_at: "2026-05-03T18:00:00+08:00",
      cover: {
        temporary_url: "https://example.test/cover?token=secret",
        media_type: "IMAGE",
      },
      file: null,
    });

    assert.equal(item.content?.includes("https://"), false);
    assert.equal(item.content?.includes("x-looki-token"), false);
    assert.deepEqual(item.mediaTypes, ["IMAGE"]);
  });

  it("attaches For You hints to text-matching moments", () => {
    const enriched = attachForYouHints(
      {
        id: "moment-1",
        title: "迪卡侬选购与组装自行车",
        description: "孩子在店内试骑并等待新车组装",
        mediaTypes: ["VIDEO", "AUDIO"],
        date: "2026-05-03",
        tz: "+08:00",
        startTime: "2026-05-03T17:42:15+08:00",
        endTime: "2026-05-03T18:42:55+08:00",
      },
      [
        {
          id: "for-you-1",
          type: "IMAGE_POST",
          title: "迪卡侬亲子选车",
          description: "看着孩子对新车充满期待。",
          content: "店内试骑、服务台组装和离店骑行。",
          createdAt: "2026-05-04T03:54:20+08:00",
          recordedAt: "2026-05-03T18:00:00+08:00",
          mediaTypes: ["IMAGE"],
        },
      ],
    );

    assert.equal(enriched.forYouHints?.[0]?.id, "for-you-1");
    assert.equal(enriched.forYouHints?.[0]?.matchReason, "text");
    assert.equal(enriched.forYouHints?.[0]?.role, "audio_context");
    assert.ok((enriched.forYouScore || 0) > 0.36);
  });

  it("matches end-of-day For You summaries by text", () => {
    const enriched = attachForYouHints(
      {
        id: "moment-bike",
        title: "迪卡侬选购与组装自行车",
        description: "在迪卡侬商店内挑选儿童自行车并等待服务台组装调试。",
        mediaTypes: ["VIDEO"],
        date: "2026-05-03",
        tz: "+08:00",
        startTime: "2026-05-03T17:42:15+08:00",
        endTime: "2026-05-03T18:42:55+08:00",
      },
      [
        {
          id: "for-you-late",
          type: "IMAGE_POST",
          title: "迪卡侬亲子选车",
          description: "看着孩子对新车充满期待。",
          content:
            "带孩子来到迪卡侬商店，为孩子挑选新自行车，并在服务台前看着新车被组装。",
          createdAt: "2026-05-04T03:54:20+08:00",
          recordedAt: "2026-05-03T23:59:59+08:00",
          mediaTypes: ["IMAGE"],
        },
      ],
    );

    assert.equal(enriched.forYouHints?.[0]?.id, "for-you-late");
    assert.equal(enriched.forYouHints?.[0]?.matchReason, "text");
    assert.equal(enriched.forYouHints?.[0]?.role, "memory_evidence");
  });

  it("assigns time-only For You summaries to the single best moment", () => {
    const enriched = attachForYouHintsToMoments(
      [
        {
          id: "moment-generic",
          title: "午后高效办公",
          description: "在电脑前处理工作。",
          mediaTypes: ["VIDEO"],
          date: "2026-05-04",
          tz: "+08:00",
          startTime: "2026-05-04T13:30:00+08:00",
          endTime: "2026-05-04T14:30:00+08:00",
        },
        {
          id: "moment-coffee",
          title: "咖啡风味探讨",
          description: "讨论芒果酱风味和生椰拿铁。",
          mediaTypes: ["AUDIO"],
          date: "2026-05-04",
          tz: "+08:00",
          startTime: "2026-05-04T13:47:51+08:00",
          endTime: "2026-05-04T13:50:52+08:00",
        },
      ],
      [
        {
          id: "for-you-coffee",
          type: "MOMENT_POST",
          title: "咖啡风味探讨",
          description: "讨论芒果酱风味和生椰拿铁。",
          content: "后续计划是给可乐带一杯咖啡。",
          createdAt: "2026-05-04T20:19:21+08:00",
          recordedAt: "2026-05-04T13:47:51+08:00",
          mediaTypes: ["AUDIO"],
        },
      ],
    );

    assert.equal(enriched[0]?.forYouHints, undefined);
    assert.equal(enriched[1]?.forYouHints?.[0]?.id, "for-you-coffee");
  });

  it("can attach a time-only For You summary when no better moment exists", () => {
    const enriched = attachForYouHintsToMoments(
      [
        {
          id: "moment-generic",
          title: "午后高效办公",
          description: "在电脑前处理工作。",
          mediaTypes: ["VIDEO"],
          date: "2026-05-04",
          tz: "+08:00",
          startTime: "2026-05-04T13:30:00+08:00",
          endTime: "2026-05-04T14:30:00+08:00",
        },
      ],
      [
        {
          id: "for-you-coffee",
          type: "MOMENT_POST",
          title: "咖啡风味探讨",
          description: "讨论芒果酱风味和生椰拿铁。",
          content: "后续计划是给可乐带一杯咖啡。",
          createdAt: "2026-05-04T20:19:21+08:00",
          recordedAt: "2026-05-04T13:47:51+08:00",
          mediaTypes: ["AUDIO"],
        },
      ],
    );

    assert.equal(enriched[0]?.forYouHints?.[0]?.id, "for-you-coffee");
    assert.equal(enriched[0]?.forYouHints?.[0]?.matchReason, "time");
  });

  it("does not attach time-only For You outside the strong time window", () => {
    const enriched = attachForYouHints(
      {
        id: "moment-work",
        title: "午后办公",
        description: "在电脑前处理工作。",
        mediaTypes: ["VIDEO"],
        date: "2026-05-04",
        tz: "+08:00",
        startTime: "2026-05-04T13:00:00+08:00",
        endTime: "2026-05-04T13:05:00+08:00",
      },
      [
        {
          id: "for-you-coffee",
          type: "MOMENT_POST",
          title: "咖啡风味探讨",
          description: "讨论芒果酱风味和生椰拿铁。",
          content: "后续计划是给可乐带一杯咖啡。",
          createdAt: "2026-05-04T20:19:21+08:00",
          recordedAt: "2026-05-04T13:21:00+08:00",
          mediaTypes: ["AUDIO"],
        },
      ],
    );

    assert.equal(enriched.forYouHints, undefined);
  });
});

describe("memory payload boundaries", () => {
  it("keeps rich Looki metadata out of the cloud core memory payload", () => {
    const payload = buildOmiMemoryCreatePayload(testMemoryCandidate());
    const raw = JSON.stringify(payload);

    assert.deepEqual(payload, {
      content: "用户重视陪孩子参与户外活动。",
      visibility: "private",
      category: "manual",
      tags: ["looki", "looki_daily", "looki_2026_05_03", "family_milestone"],
    });
    assert.equal(raw.includes("contextSummary"), false);
    assert.equal(raw.includes("headline"), false);
    assert.equal(raw.includes("sourceMomentIds"), false);
    assert.equal(raw.includes("confidence"), false);
  });

  it("wraps explicit memories for the Omi Integration import API", () => {
    const payload = buildOmiIntegrationMemoryImportPayload(
      testMemoryCandidate(),
    );

    assert.deepEqual(payload, {
      text: ".",
      text_source: "other",
      text_source_spec: "Looki selected memory candidate",
      memories: [
        {
          content: "用户重视陪孩子参与户外活动。",
          tags: [
            "looki",
            "looki_daily",
            "looki_2026_05_03",
            "family_milestone",
          ],
        },
      ],
    });
  });

  it("builds text-only payloads for Omi native memory extraction", () => {
    const payload = buildOmiIntegrationMemoryTextPayload(
      "标题：城市夜景\n摘要：和家人一起在家欣赏城市夜景。",
      "looki:2026-05-04:for_you:item-1",
    );

    assert.deepEqual(payload, {
      text: "标题：城市夜景\n摘要：和家人一起在家欣赏城市夜景。",
      text_source: "other",
      text_source_spec: "looki:2026-05-04:for_you:item-1",
    });
    assert.equal("memories" in payload, false);
  });

  it("detects verbose event summaries that do not match Omi memory style", () => {
    assert.equal(
      contentLooksNarrativeSummary(
        "一次从公寓出发的电梯下楼后骑行之旅，沿街骑行至公园，在绿地中享受休闲时光。期间与孩子进行了亲切互动，结束后返回公寓。",
      ),
      true,
    );
    assert.equal(
      contentLooksNarrativeSummary("用户喜欢和家人一起骑行。"),
      false,
    );
  });
});

describe("file store import jobs", () => {
  it("returns queued and processing jobs in update order", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "looki-omi-bridge-"));
    process.env.LOCAL_APP_STORE_PATH = path.join(dir, "app-store.json");
    const { FileAppStore } = await import("@/src/server/store/file-store");
    const store = new FileAppStore();

    await store.appendLedger(testLedgerRecord("u1", "done", "imported", 3));
    await store.appendLedger(testLedgerRecord("u1", "queued-new", "queued", 2));
    await store.appendLedger(
      testLedgerRecord("u1", "processing-old", "processing", 1),
    );

    const jobs = await store.listImportJobs({
      statuses: ["queued", "processing"],
    });

    assert.deepEqual(
      jobs.map((job) => job.record.idempotencyKey),
      ["processing-old", "queued-new"],
    );
  });
});

describe("checked JSON artifacts", () => {
  it("parses schemas and templates", async () => {
    for (const file of [
      "schemas/import-ledger-record.schema.json",
      "schemas/omi-memory-candidate.schema.json",
      "schemas/omi-memory-create.schema.json",
      "templates/omi-memory-candidate.example.json",
      "templates/omi-memory-create.example.json",
      "templates/omi-from-segments.example.json",
    ]) {
      JSON.parse(await readFile(file, "utf8"));
    }

    const ledgerLines = (
      await readFile("templates/import-ledger.example.jsonl", "utf8")
    )
      .split("\n")
      .filter(Boolean);
    assert.ok(ledgerLines.length > 0);
    for (const line of ledgerLines) JSON.parse(line);
  });
});

function testLedgerRecord(
  uid: string,
  key: string,
  status: ImportStatus,
  minute: number,
): AppLedgerRecord {
  const timestamp = `2026-05-04T00:${String(minute).padStart(2, "0")}:00.000Z`;
  return {
    uid,
    record: {
      idempotencyKey: key,
      target: "conversation",
      status,
      looki: {
        momentId: key,
        startTime: timestamp,
        endTime: timestamp,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

function testMemoryCandidate(): LookiMemoryCandidate {
  return {
    idempotencyKey:
      "looki:memory:2026-05-03:family_milestone:4434298e-126b-44ca-9a75-f2fd9e5722fa",
    content: "用户重视陪孩子参与户外活动。",
    eventDate: "2026-05-03",
    sourceKind: "multimodal_cluster",
    sourceMomentIds: [
      "4434298e-126b-44ca-9a75-f2fd9e5722fa",
      "dc698f94-6dbf-48a9-9a19-d5e8b3a7a224",
    ],
    eventType: "family_milestone",
    confidence: 0.92,
    evidenceDepth: "targeted_media",
    writePolicy: "auto_write",
    visibility: "private",
    tags: ["family_milestone"],
    headline: "孩子的新自行车日",
    contextSummary:
      "Looki 当日音视频显示，用户与孩子完成了一次儿童自行车选购、店内调试、离店骑行和夜间试骑，属于亲子成长事件。",
    currentActivity: "处理 Looki 每日音视频并筛选有价值记忆",
    evidence: [
      {
        kind: "visual",
        summary:
          "店内画面显示儿童自行车陈列、工作室调试和孩子傍晚骑/推新车离店。",
        confidence: 0.95,
        sourceMomentId: "4434298e-126b-44ca-9a75-f2fd9e5722fa",
      },
    ],
  };
}
