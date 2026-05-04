import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
