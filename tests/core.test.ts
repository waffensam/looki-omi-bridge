import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { AppLedgerRecord } from "@/src/app-types";
import type { ImportStatus } from "@/src/contracts";
import {
  conversationIdempotencyKey,
  memoryIdempotencyKey,
} from "@/src/server/idempotency";
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
