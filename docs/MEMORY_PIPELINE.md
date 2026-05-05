# Memory Pipeline

## Purpose

The memory lane converts high-value Looki daily/multimodal evidence into Omi memory candidates.

It does not replace the conversation import lane. The two lanes share Looki discovery, ASR, value gating, and the ledger, but they produce different Omi artifacts:

- conversation lane in public v1: `POST /v2/integrations/{app_id}/user/conversations`
- memory lane in public v1: Omi Integration API native memory extraction plus ledger metadata

## Inputs

Memory sources can come from:

- Looki daily timeline titles and descriptions
- sanitized For You items selected by the user
- selected moment candidates, optionally with selected For You items as extra Omi source text
- user confirmation

Do not deep-analyze original media for the memory lane by default. Omi memory is
a lightweight core record, so the bridge uses moment title/description for the
first pass and For You as Looki's already-processed enrichment layer. The UI
does not need to display semantic clustering; memory wording and extraction
happen inside Omi's native memory pipeline.

## Candidate Shape

Use `schemas/omi-memory-candidate.schema.json`.

Example:

```json
{
  "idempotencyKey": "looki:memory:2026-05-03:family_milestone:4434298e-126b-44ca-9a75-f2fd9e5722fa",
  "content": "用户重视陪孩子参与户外活动。",
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

The memory body should also match Omi's native memory style:

- short, direct, and timeless
- about a durable fact, preference, habit, relationship, or meaningful personal context
- not a diary summary of what happened during a Looki moment
- no dates, weekdays, source names, or poetic For You wording

## Value Gate

The first implementation may auto-write from a strong Looki moment summary. It does not need targeted media for every write.

Record the evidence depth:

- `moment_summary`: title/description/time range are strong enough to write
- `for_you_enriched_summary`: selected For You content, alone or as context for a selected moment, is strong enough to write
- `targeted_media_required`: promising but ambiguous; do not write until media is inspected
- `targeted_media`: targeted media/key-frame/OCR/ASR was inspected
- `user_review`: user confirmed or corrected the candidate

### Auto Write

Use `auto_write` only when all are true:

- confidence is at least `0.85`
- memory is reusable beyond the day it happened
- evidence includes a strong Looki moment summary, For You enrichment, visual, ASR, OCR, or user-review reason
- it is not already represented in Omi memories
- evidence depth is `moment_summary`, `for_you_enriched_summary`, `targeted_media`, or `user_review`

Use `moment_summary` or `for_you_enriched_summary` auto-write only when the
resulting memory sentence is concrete, durable, non-routine, and
non-speculative. For You content can supply details, but the cloud memory body
must still be a short date-free fact, not Looki's original prose.

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

The durable explicit-memory core payload is `schemas/omi-memory-create.schema.json`,
but this is not the default hosted app path:

```json
{
  "content": "用户重视陪孩子参与户外活动。",
  "visibility": "private",
  "category": "manual",
  "tags": ["looki", "looki_daily", "looki_2026_05_03", "family_milestone"]
}
```

For this Omi App bridge, the hosted app-compatible write path is `POST /v2/integrations/{app_id}/user/memories?uid={user_id}` with text-only Omi native extraction. Do not send `memories[]` in the default path; sending both `text` and `memories[]` can create duplicate memories.

```json
{
  "text": "标题：家的暖色时光\n摘要：和家人一起在家中欣赏城市夜景。",
  "text_source": "other",
  "text_source_spec": "looki:2026-05-04:for_you:example"
}
```

The bridge records source text hashes, previews, selected Looki ids, and import
status in the ledger. Omi owns the final memory wording and may extract zero,
one, or multiple memories from a selected source.

Developer API memory CRUD is not part of the public Omi App v1 flow. If a local
operator explicitly runs a Developer API-only diagnostic path, treat
`POST /v1/dev/user/memories` as a core-field write surface and keep `headline`
or rich metadata in the candidate/enrichment layer until backend persistence is
confirmed.

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
- local SQLite enrichment is optional, cache-only, and only possible from a local helper/native app that has explicit access to the user's Omi data directory
- the hosted Omi App bridge cannot safely write the user's local Omi SQLite database
- ledger must record `richMetadataSynced=false` and `sqliteCacheOnly=true`

Do not use local enrichment as the only write path.

## Integration With Conversation Imports

One Looki audio/video event can produce:

- a conversation import, when the transcript itself is worth preserving
- a memory candidate, when the event contains a durable fact or milestone
- neither, when it is routine or noisy

Avoid automatically creating a memory from every imported conversation. Omi may already extract memories from conversation processing, and the bridge should dedupe against existing memories before writing.
