# Looki To Omi Memory Format Handoff

This handoff is for the app/thread implementing Looki -> Omi memory import.

## Core Decision

Use two memory layers:

1. Cloud authoritative memory: Omi backend core fields only.
2. Local rich display metadata: optional cache/enrichment after a backend memory id exists.

Do not treat local rich metadata as cloud sync unless the exact backend endpoint returns the same fields on a clean fetch.

## Omi Native Reference

Omi Desktop `APIClient.createMemory()` sends this user-auth `/v3/memories` request shape:

```json
{
  "content": "string",
  "visibility": "private",
  "category": "manual",
  "confidence": 0.92,
  "source_app": "Looki",
  "context_summary": "string",
  "tags": ["looki"],
  "reasoning": "string",
  "current_activity": "string",
  "source": "looki",
  "window_title": "Looki 2026-05-03 daily timeline",
  "headline": "孩子的新自行车日"
}
```

Important caveat: the current Python cloud `/v3/memories` path accepts `headline` in the request model, but `MemoryDB.from_memory()` does not carry `headline` or rich context fields into the stored memory. The Developer API `/v1/dev/user/memories` is stricter and only persists core fields.

The local Omi Desktop `memories` table can store richer display fields:

```text
backendId
backendSynced
content
category
tagsJson
visibility
reviewed
userReview
manuallyAdded
scoring
source
conversationId
screenshotId
confidence
reasoning
sourceApp
windowTitle
contextSummary
currentActivity
inputDeviceName
headline
isRead
isDismissed
deleted
createdAt
updatedAt
```

## Looki Memory Candidate

Build this internal candidate before writing anything:

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
  "evidenceDepth": "targeted_media",
  "writePolicy": "auto_write",
  "visibility": "private",
  "tags": ["family_milestone"],
  "headline": "孩子的新自行车日",
  "contextSummary": "Looki 当日音视频显示，用户与孩子完成了一次儿童自行车选购、店内调试、离店骑行和夜间试骑，属于亲子成长事件。",
  "currentActivity": "处理 Looki 每日音视频并筛选有价值记忆",
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

Rules:

- `content` must be date-free and source-free.
- Do not start content with `2026-05-03` or `Looki 显示`.
- Put date in `eventDate`, tags, and ledger fields.
- `confidence` is `0.0` to `1.0`.
- `auto_write` requires `confidence >= 0.85`.
- Routine meals, commuting, washing, scrolling, and noisy clips should be `stage_only` or `never_write`.

## Cloud Core Payload

Default endpoint for this Omi App bridge:

```text
POST /v2/integrations/{app_id}/user/memories?uid={user_id}
Authorization: Bearer {OMI_APP_API_KEY}
```

The App Integration API request should use explicit memory objects only:

```json
{
  "memories": [
    {
      "content": "用户陪孩子在迪卡侬挑选并调试过儿童自行车，并一起完成了离店骑行和夜间试骑。",
      "tags": ["looki", "looki_daily", "looki_2026_05_03", "family_milestone"]
    }
  ]
}
```

Do not include `contextSummary` as top-level `text` when writing explicit
memories. It is local/ledger context, not a second cloud memory extraction
source.

Developer API alternative:

```text
POST /v1/dev/user/memories
Authorization: Bearer {OMI_DEV_API_KEY}
```

Required scopes:

```text
memories:read
memories:write
```

If using the Developer API, write only:

```json
{
  "content": "用户陪孩子在迪卡侬挑选并调试过儿童自行车，并一起完成了离店骑行和夜间试骑。",
  "visibility": "private",
  "category": "manual",
  "tags": ["looki", "looki_daily", "looki_2026_05_03", "family_milestone"]
}
```

Do not send these in either cloud core write:

```text
headline
confidence
source_app
context_summary
current_activity
source
window_title
reasoning
sourceMomentIds
evidence
eventDate
```

Those belong in candidate, ledger, or optional local enrichment.

## Local Rich Enrichment

Only after the cloud write returns an Omi memory id, optionally enrich the matching local Omi row.

Use this shape:

```json
{
  "backendId": "d2182083-bd85-4249-a927-709d9ae9a370",
  "backendSynced": true,
  "source": "looki",
  "confidence": 0.92,
  "sourceApp": "Looki",
  "contextSummary": "Looki 当日音视频显示，用户与孩子完成了一次儿童自行车选购、店内调试、离店骑行和夜间试骑，属于亲子成长事件。",
  "currentActivity": "处理 Looki 每日音视频并筛选有价值记忆",
  "windowTitle": "Looki 2026-05-03 daily timeline",
  "headline": "孩子的新自行车日"
}
```

Local enrichment rules:

- Never create a local-only memory as the source of truth.
- Only enrich a row associated with a real backend memory id.
- Mark the ledger as cache-only.
- Do not claim cross-device sync for `headline`, `contextSummary`, `currentActivity`, `windowTitle`, or `sourceApp`.

## Ledger Record

Every write attempt should produce or update one ledger record:

```json
{
  "idempotencyKey": "looki:memory:2026-05-03:family_milestone:4434298e-126b-44ca-9a75-f2fd9e5722fa",
  "target": "memory",
  "status": "imported",
  "decision": "import",
  "looki": {
    "momentId": "4434298e-126b-44ca-9a75-f2fd9e5722fa",
    "title": "迪卡侬选购与组装自行车",
    "startTime": "2026-05-03T17:42:15+08:00",
    "endTime": "2026-05-03T18:42:55+08:00",
    "mediaTypes": ["VIDEO", "AUDIO"]
  },
  "memory": {
    "content": "用户陪孩子在迪卡侬挑选并调试过儿童自行车，并一起完成了离店骑行和夜间试骑。",
    "writePolicy": "auto_write",
    "evidenceDepth": "targeted_media",
    "confidence": 0.92,
    "eventDate": "2026-05-03",
    "eventType": "family_milestone",
    "tags": ["looki", "looki_daily", "looki_2026_05_03", "family_milestone"]
  },
  "omi": {
    "memoryId": "d2182083-bd85-4249-a927-709d9ae9a370",
    "method": "memory_create",
    "source": "looki",
    "richMetadataSynced": false
  },
  "local": {
    "enriched": true,
    "sqliteCacheOnly": true
  },
  "createdAt": "2026-05-04T01:40:37+08:00",
  "updatedAt": "2026-05-04T01:49:38+08:00"
}
```

## Write Sequence

1. Build `LookiMemoryCandidate`.
2. Validate `content`, `confidence`, `sourceMomentIds`, and `contextSummary`.
3. Generate tags: `looki`, `looki_daily`, `looki_YYYY_MM_DD`, `eventType`, plus candidate tags.
4. Dedupe against Omi memories and ledger.
5. If `writePolicy=auto_write`, call `POST /v2/integrations/{app_id}/user/memories` with explicit `memories[]` core payload only. Use `POST /v1/dev/user/memories` only when this bridge is running under a user Developer API key instead of the Omi App API key.
6. Record `omi.memoryId`, `method=memory_create`, and `richMetadataSynced=false`.
7. Optionally enrich the local row for display.
8. Record `local.enriched=true` and `local.sqliteCacheOnly=true`.

## Practical Mapping

| Concept           | Cloud core | Local rich             | Ledger/candidate                                   |
| ----------------- | ---------- | ---------------------- | -------------------------------------------------- |
| Memory sentence   | `content`  | `content`              | `memory.content`                                   |
| Date              | tags only  | optional `windowTitle` | `eventDate`, `looki.startTime`, `looki_YYYY_MM_DD` |
| Source app        | no         | `sourceApp = Looki`    | evidence/source metadata                           |
| Source type       | no         | `source = looki`       | `omi.source = looki`                               |
| Confidence        | no         | `confidence`           | `memory.confidence`                                |
| Context summary   | no         | `contextSummary`       | candidate context                                  |
| Current activity  | no         | `currentActivity`      | candidate context                                  |
| Headline          | no         | `headline`             | candidate headline                                 |
| Source moment ids | no         | no                     | `sourceMomentIds`, `looki.momentId`                |
| Evidence details  | no         | no                     | `evidence`, `evidenceDepth`                        |

## Product Defaults

- Default memory category: `manual`.
- Default visibility: `private`.
- Default source tag set: `looki`, `looki_daily`, `looki_YYYY_MM_DD`.
- Default source app label: `Looki`.
- Default source value: `looki`.
- Default write mode before review: `stage_only`.
- Allow `auto_write` only for concrete, durable, non-routine memories with high confidence.
