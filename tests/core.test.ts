import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { AppLedgerRecord } from "@/src/app-types";
import type { ImportStatus, LookiMemoryCandidate } from "@/src/contracts";
import { buildOmiMemoryCreatePayload } from "@/src/memory";
import {
  conversationIdempotencyKey,
  memoryIdempotencyKey,
} from "@/src/server/idempotency";
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

describe("memory payload boundaries", () => {
  it("keeps rich Looki metadata out of the cloud core memory payload", () => {
    const payload = buildOmiMemoryCreatePayload(testMemoryCandidate());
    const raw = JSON.stringify(payload);

    assert.deepEqual(payload, {
      content:
        "用户陪孩子在迪卡侬挑选并调试过儿童自行车，并一起完成了离店骑行和夜间试骑。",
      visibility: "private",
      category: "manual",
      tags: ["looki", "looki_daily", "looki_2026_05_03", "family_milestone"],
    });
    assert.equal(raw.includes("contextSummary"), false);
    assert.equal(raw.includes("headline"), false);
    assert.equal(raw.includes("sourceMomentIds"), false);
    assert.equal(raw.includes("confidence"), false);
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
    content:
      "用户陪孩子在迪卡侬挑选并调试过儿童自行车，并一起完成了离店骑行和夜间试骑。",
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
