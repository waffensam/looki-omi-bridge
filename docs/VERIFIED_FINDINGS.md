# Verified Findings

This file records facts verified during the initial Looki -> ASR -> Omi exploration. It is intentionally concrete so future implementation does not rediscover the same edge cases.

## Looki Audio Samples

Date: `2026-04-28`

Two Looki `AUDIO` moments were inspected:

| Time                | Title            |  Duration | Notes                                                        |
| ------------------- | ---------------- | --------: | ------------------------------------------------------------ |
| `08:42:12-08:42:37` | `回家取快递提醒` | `25281ms` | reminder to pick up delivery, plus home-recognition question |
| `08:43:35-08:43:51` | `取回早盆`       | `15941ms` | reminder around 4pm to get a basin                           |

The public Looki moments API exposed title, description, media metadata, and temporary audio URLs. It did not expose raw word-for-word transcript fields.

Downloaded media was AAC/M4A, 16kHz, mono.

## XFYun Trial

Provider base:

```text
https://office-api-ist-dx.iflyaisol.com
```

Working calls:

```text
POST /v2/upload
POST /v2/getResult
```

First failed parameter:

```text
language=cn
```

Error:

```json
{
  "code": "100020",
  "descInfo": "language verify fail, cause: language[cn] does not support"
}
```

Working value:

```text
language=autodialect
```

`duration` was sent in milliseconds.

Observed successful order ids:

| Sample  | XFYun order id                           | Status | Transcript                                                                       |
| ------- | ---------------------------------------- | -----: | -------------------------------------------------------------------------------- |
| `08:42` | `DKHJQ20260504002559917jtUlOxV7Y5D8zVDq` |    `4` | `今天晚上别忘了拿快递啊在我到家之后你能认识我的家吗？通过录像判断还是定位判断。` |
| `08:43` | `DKHJQ20260504002617467jXlLwgLh6rdYBm0R` |    `4` | `4:30哦4:00吧4:00的时候，提醒我要去崇山路拿澡盆。`                               |

## Omi Trial

Omi Dev had a valid Firebase login state. Firebase auth could create Developer API keys through:

```text
POST /v1/dev/keys
```

Existing Developer API key metadata was readable, but old key secret values were not returned and could not be reused.

Two temporary validation keys were created during exploration:

- `3a28dcd8-c9eb-47ed-ba66-5a6dfbfcc8d3`
- `34cf3d74-a443-46ec-af36-ad845e8df21b`

They were scoped to conversations. Future runs should use one configured durable key instead of creating new keys per run.

### From-Segments Failure

The first `from-segments` attempt used:

```json
{ "source": "external_integration" }
```

Omi returned HTTP 500:

```json
{ "detail": "Error processing conversation, please try again later" }
```

Local upstream code explains the failure: `source=external_integration` enters a branch that expects `text_source`, but the segmented endpoint constructs `CreateConversation`, which has `transcript_segments` and no `text_source`.

Canonical future payload should use:

```json
{ "source": "unknown" }
```

The `source=unknown` path is the accepted design for future imports. It was not used to re-import the already imported 2026-04-28 samples to avoid duplicates.

### Text Fallback Success

The two 2026-04-28 samples were successfully imported through:

```text
POST /v1/dev/user/conversations
```

Results:

| Sample  | Omi conversation id                    | Status      | Discarded |
| ------- | -------------------------------------- | ----------- | --------- |
| `08:42` | `8adb767c-9328-4bb2-8c22-ba293b5f80c5` | `completed` | `false`   |
| `08:43` | `7691fbef-53fe-4111-9357-4e270bda3fd1` | `completed` | `false`   |

Ledger records for these specific samples must mark `method: "text_fallback"`, not `from_segments`.

## Looki Daily Memory Trial

Date: `2026-05-03`

Looki returned a full daily timeline with non-continuous, interval-based events. The useful memory signal did not come from treating the whole day as one conversation. It came from selecting a high-value cluster:

```text
17:42:15-18:42:55 迪卡侬选购与组装自行车
18:44:51-19:18:09 装载新车并顺利归家
19:21:06-19:49:56 夜骑探索与晚间休闲
```

Targeted visual review showed a family/child bicycle purchase, store service/assembly, loading the bicycle into the car, returning home, and a later night ride. This is a durable family milestone, not a routine diary item.

Targeted XFYun ASR was useful as supporting evidence, but not sufficient by itself:

| Clip                   | Observed ASR                                | Notes                           |
| ---------------------- | ------------------------------------------- | ------------------------------- |
| store/service entry    | `来我需要系统看一下您的购物记录，ok。`      | useful purchase/service context |
| selecting/inside store | noisy partial text around `我喜欢为什么...` | low confidence                  |
| leaving/loading        | `小心不知不觉间就这么晚了，对。`            | useful end-of-event context     |
| night ride             | failed or silence                           | no useful transcript            |

The resulting memory content should be date-free:

```text
用户陪孩子在迪卡侬挑选并调试过儿童自行车，并一起完成了离店骑行和夜间试骑。
```

Use tags and ledger metadata for the date and provenance:

```text
looki
looki_daily
looki_2026_05_03
family_milestone
```

## Omi Memory Write Trial

A single Omi memory write was tested with a local user-authenticated Omi session.

Created memory id:

```text
d2182083-bd85-4249-a927-709d9ae9a370
```

Core memory content after correction:

```text
用户陪孩子在迪卡侬挑选并调试过儿童自行车，并一起完成了离店骑行和夜间试骑。
```

The memory body was corrected to remove date/provenance from the content itself. The date belongs in tags and ledger fields, not the memory sentence.

Local SQLite was then patched only for display parity on the already-created backend memory row. Enriched fields used in the local display:

```json
{
  "confidence": 0.92,
  "source": "looki",
  "sourceApp": "Looki",
  "contextSummary": "Looki 当日音视频显示，用户与孩子完成了一次儿童自行车选购、店内调试、离店骑行和夜间试骑，属于亲子成长事件。",
  "currentActivity": "处理 Looki 每日音视频并筛选有价值记忆",
  "windowTitle": "Looki 2026-05-03 daily timeline",
  "headline": "孩子的新自行车日"
}
```

Ledger entries for this pattern must mark local enrichment as cache-only:

```json
{
  "omi": {
    "memoryId": "d2182083-bd85-4249-a927-709d9ae9a370",
    "richMetadataSynced": false
  },
  "local": {
    "enriched": true,
    "sqliteCacheOnly": true
  }
}
```

## Omi Memory API Surface

Confirmed code-level distinction:

- Python Developer API `/v1/dev/user/memories` persists the core fields `content`, `category`, `visibility`, and `tags`.
- Python user-auth `/v3/memories` accepts `headline` in the request model, but `MemoryDB.from_memory()` does not carry it into the stored memory object.
- Python memory create paths do not preserve `confidence`, `source_app`, `context_summary`, `current_activity`, `source`, or `window_title`.
- Desktop Rust `/v3/memories` has a richer local/backend route for `confidence`, `source_app`, `context_summary`, `current_activity`, `source`, and `window_title`, but that should not be treated as the default cloud Developer API contract for this bridge.
- Local SQLite can be enriched for richer desktop display, including `headline`, but that does not prove multi-device backend sync.

## Security Notes

XFYun credentials were pasted during exploration. Rotate them before turning this into an unattended daily job.

Do not print:

- Looki API key
- Looki signed audio URLs
- XFYun API key or secret
- Omi Firebase id token or refresh token
- Omi Developer API key secret
