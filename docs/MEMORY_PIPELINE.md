# Memory Pipeline

## Purpose

The memory lane converts high-value Looki daily/multimodal evidence into Omi memory candidates.

It does not replace the conversation import lane. The two lanes share Looki discovery, ASR, value gating, and the ledger, but they produce different Omi artifacts:

- conversation lane: `POST /v1/dev/user/conversations/from-segments`
- memory lane: Omi memory core write plus optional local rich metadata

## Inputs

Memory candidates can come from:

- Looki daily timeline titles and descriptions
- targeted video/key-frame analysis
- OCR evidence
- ASR evidence from relevant clips
- user confirmation

Do not deep-analyze the whole day by default. Pick high-value clusters first.

## Candidate Shape

Use `schemas/omi-memory-candidate.schema.json`.

Example:

```json
{
  "idempotencyKey": "looki:memory:2026-05-03:family_milestone:4434298e-126b-44ca-9a75-f2fd9e5722fa",
  "content": "用户陪孩子在迪卡侬挑选并调试过儿童自行车，并一起完成了离店骑行和夜间试骑。",
  "eventDate": "2026-05-03",
  "sourceKind": "multimodal_cluster",
  "sourceMomentIds": [
    "4434298e-126b-44ca-9a75-f2fd9e5722fa",
    "dc698f94-6dbf-48a9-9a19-d5e8b3a7a224"
  ],
  "eventType": "family_milestone",
  "confidence": 0.92,
  "writePolicy": "auto_write",
  "visibility": "private",
  "tags": ["family_milestone"],
  "headline": "孩子的新自行车日",
  "contextSummary": "Looki 当日音视频显示，用户与孩子完成了一次儿童自行车选购、店内调试、离店骑行和夜间试骑，属于亲子成长事件。",
  "evidence": [
    {
      "kind": "visual",
      "summary": "店内画面显示儿童自行车陈列、工作室调试和孩子傍晚骑/推新车离店。",
      "confidence": 0.95,
      "sourceMomentId": "4434298e-126b-44ca-9a75-f2fd9e5722fa"
    },
    {
      "kind": "asr",
      "summary": "服务台相关音频提到查看购物记录，离店片段出现小心和天色已晚的提醒。",
      "confidence": 0.75,
      "sourceMomentId": "dc698f94-6dbf-48a9-9a19-d5e8b3a7a224"
    }
  ]
}
```

The memory body is intentionally date-free. Date belongs in:

- `eventDate`
- ledger `looki.startTime`
- tags such as `looki_2026_05_03`

## Value Gate

The first implementation may auto-write from a strong Looki moment summary. It does not need targeted media for every write.

Record the evidence depth:

- `moment_summary`: title/description/time range are strong enough to write
- `targeted_media_required`: promising but ambiguous; do not write until media is inspected
- `targeted_media`: targeted media/key-frame/OCR/ASR was inspected
- `user_review`: user confirmed or corrected the candidate

### Auto Write

Use `auto_write` only when all are true:

- confidence is at least `0.85`
- memory is reusable beyond the day it happened
- evidence includes a strong Looki moment summary, visual, ASR, OCR, or user-review reason
- it is not already represented in Omi memories
- evidence depth is `moment_summary`, `targeted_media`, or `user_review`

Use `moment_summary` auto-write only when the Looki title/description is concrete, durable, non-routine, and non-speculative.

### Stage Only

Use `stage_only` when:

- confidence is medium
- ASR/OCR is noisy
- content is more diary-like than durable
- a user review would improve wording
- evidence depth is `targeted_media_required`

### Never Write

Use `never_write` for:

- meals, washing, commuting, casual scrolling, and routine transitions
- safety suggestions inferred from weak visual evidence
- temporary observations without future reuse
- tasks without explicit future commitment

## Omi Write

The durable core payload is `schemas/omi-memory-create.schema.json`:

```json
{
  "content": "用户陪孩子在迪卡侬挑选并调试过儿童自行车，并一起完成了离店骑行和夜间试骑。",
  "visibility": "private",
  "category": "manual",
  "tags": ["looki", "looki_daily", "looki_2026_05_03", "family_milestone"]
}
```

Prefer a configured Omi Developer API key with:

- `memories:read`
- `memories:write`

Use `POST /v1/dev/user/memories` for single memory writes and `GET /v1/dev/user/memories` for dedupe reads. `headline` can remain on the `LookiMemoryCandidate` and local rich metadata, but is not part of the Developer API core create payload. User-auth `/v3/memories` should be treated the same for bridge purposes because the current Python `MemoryDB.from_memory()` path does not preserve headline or rich context fields.

Read existing memories before writing so the bridge can keep/patch/skip instead of creating duplicates.

## Rich Metadata

Omi Desktop can display:

- confidence
- source app
- device/source
- context summary
- current activity
- window title
- headline

Current backend memory models do not preserve all rich fields across devices. Until that is fixed:

- backend is authoritative for core memory
- local SQLite enrichment is optional and cache-only
- ledger must record `richMetadataSynced=false` and `sqliteCacheOnly=true`

Do not use local enrichment as the only write path.

## Integration With Conversation Imports

One Looki audio/video event can produce:

- a conversation import, when the transcript itself is worth preserving
- a memory candidate, when the event contains a durable fact or milestone
- neither, when it is routine or noisy

Avoid automatically creating a memory from every imported conversation. Omi may already extract memories from conversation processing, and the bridge should dedupe against existing memories before writing.
