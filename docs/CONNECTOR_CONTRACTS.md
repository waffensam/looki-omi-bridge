# Connector Contracts

## Looki Connector

Source of truth: `looki-memory` skill at `/Users/snode/.codex/skills/looki-memory/SKILL.md`.

### Input

- `on_date` or date range
- Looki API base URL
- Looki API key

### Output

Conversation lane:

- array of `LookiAudioMoment`
- sanitized For You hints for display only

Memory lane:

- array of `LookiTimelineEvent`
- sanitized For You items as independent Looki-processed memory sources

### Endpoint Shape

Credentials come from `~/.config/looki/credentials.json`.

Validate `base_url` before first use:

```text
GET https://open.looki.ai/api/v1/verify?endpoint={base_url}
```

Do not send the API key to the verify endpoint.

Use `X-API-Key` only for requests to `{base_url}`:

```text
GET {base_url}/me
GET {base_url}/moments/calendar?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
GET {base_url}/moments?on_date=YYYY-MM-DD
GET {base_url}/moments/{moment_id}
GET {base_url}/moments/{moment_id}/files?highlight=true&limit=20
GET {base_url}/moments/{moment_id}/files?limit=100&cursor_id=...
GET {base_url}/moments/search?query=...&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
GET {base_url}/for_you/items?group=all&recorded_from=YYYY-MM-DD&recorded_to=YYYY-MM-DD&order_by=recorded_at&limit=100
```

`FileModel.temporary_url` expires in one hour. Fetch media only after a candidate is selected, and never persist signed URLs.

For You `content` can contain markdown image links with signed URLs. Strip
embedded URLs before returning the text to the UI, provider adapters, logs, or
the ledger.

### Rules

- Validate Looki base URL before using the API key.
- Do not log API key.
- Do not log temporary media URLs.
- Treat the Looki API key as broad read access to the user's Looki archive. The UI should make this boundary clear and avoid implying that the bridge can only see the currently selected day.
- Fetch detailed media only after explicit import selection; day listing may read moment and For You metadata for the selected date.
- Preserve Looki moment id, title, description, start/end time, timezone, duration, and media size.
- For You is not a conversation import target. Use it to annotate recordings and as a first-class selectable memory source.
- Do not force every For You item onto a moment. Show For You and moments separately in the memory UI; pass selected For You items as Omi native memory source context when needed.
- Respect Looki's 60 requests/minute API limit.

## Bailian ASR Adapter

### Provider

Bailian/DashScope Paraformer recording-file recognition is the default managed
ASR adapter.

### Current Defaults

- `model`: `paraformer-v2`
- `language_hints`: `zh,en`
- `diarization_enabled`: configurable, default off unless explicitly enabled
- `timestamp_alignment_enabled`: configurable when supported by the adapter
- `disfluency_removal_enabled`: configurable when supported by the adapter

### Rules

- Upload only user-selected Looki audio.
- Prefer URL-based upload through provider-supported temporary object storage; do not persist signed Looki media URLs.
- Record provider task id, model, output hash, original duration, billable speech duration, and estimated cost in the ledger.
- Apply configured ASR duration/monthly limits before provider upload when possible.
- Normalize sentence timestamps back onto the original media timeline.

## XFYun ASR Adapter

XFYun is a fallback adapter, not the public v1 default.

### Provider

XFYun recording-file ASR large model.

Observed endpoint base:

```text
https://office-api-ist-dx.iflyaisol.com
```

### Required Calls

```text
POST /v2/upload
POST /v2/getResult
```

### Important Parameters

- `appId`
- `accessKeyId`
- `dateTime`
- `signatureRandom`
- `fileSize`
- `fileName`
- `duration` in milliseconds
- `language`

Use `language=autodialect` for the current Chinese/mixed-language use case. `language=cn` failed with `language verify fail`.

### Signature

The current WebAPI uses a `signature` HTTP header.

Observed working signing rules:

1. Sort query parameters by key.
2. Skip empty values and the `signature` field itself.
3. Build a query-string style base string with URL-encoded keys and values.
4. HMAC-SHA1 the base string with `APISecret`.
5. Base64-encode the digest.

Do not log the base string if it contains credential identifiers. Never log `APIKey` or `APISecret`.

### Query

After upload returns an `orderId`, poll:

```text
POST /v2/getResult
```

Include:

```text
resultType=transfer
```

The successful terminal state observed in production was:

```text
orderInfo.status = 4
```

### Known Error

The first trial failed with:

```json
{
  "code": "100020",
  "descInfo": "language verify fail, cause: language[cn] does not support"
}
```

Fix: use `language=autodialect`.

### Output Mapping

Provider output should be normalized into:

```json
{
  "provider": "bailian",
  "providerOrderId": "task id or order id",
  "text": "full transcript",
  "segments": [
    {
      "text": "segment text",
      "speaker": "SPEAKER_00",
      "isUser": true,
      "start": 4.08,
      "end": 18.7
    }
  ]
}
```

### Speaker Mapping

- Bailian `speaker_id` 0 -> `SPEAKER_00`
- XFYun speaker `0` -> `SPEAKER_00`
- XFYun speaker `1` -> `SPEAKER_01`
- Missing speaker -> `SPEAKER_00`

### Result Parsing

Observed result shape:

- `content.orderResult` may be a JSON string.
- Segment candidates are under `lattice[]`.
- Segment best path is `json_1best`.
- Text tokens are nested under `st.rt[].ws[].cw[].w`.
- Segment timing is `st.bg` and `st.ed` in milliseconds.
- Speaker id, when present, is `st.rl`.

Normalize timing to seconds for Omi.

### User Mapping

Default `isUser=true` for Looki manual self recordings.

If future diarization identifies other people reliably, keep `isUser=false` for those segments.

## AI Provider Registry

The app must route ASR, OCR, and multimodal analysis through provider adapters.

### Modes

- `managed`: use project-owned provider credentials
- `user_key`: use a user-supplied provider key stored encrypted
- `subscription`: use managed providers but attribute usage to the user's paid plan

First version required mode: `managed`. `user_key` and `subscription` are future pricing/account modes and must stay hidden from the public UI until implemented end to end.

### Required Adapter Classes

- ASR adapter: audio file -> `NormalizedTranscript`
- media analysis adapter: selected image/video evidence -> evidence summaries

### Rules

- Do not let provider-specific fields leak into Omi payload contracts.
- Do not store provider API keys in the ledger.
- Record provider name, model, request/order id, and output hashes for audit.
- Keep JSON schemas versioned so a memory decision can be explained later. External memory rewriting/gating is not part of public v1.

## Omi Connector

Source of truth for public v1: Omi App Integration Import APIs.

### Integration App Key

The bridge uses the Omi app's Integration API key and app id.

Send it as:

```text
Authorization: Bearer {OMI_APP_API_KEY}
```

The user must have enabled the app, and the write call must include the Omi `uid`.

### Conversation Import Endpoint

```text
POST /v2/integrations/{app_id}/user/conversations?uid={uid}
GET /v2/integrations/{app_id}/conversations?uid={uid}
```

Payload rules:

- Send transcript `text`, original `started_at`, original `finished_at`, `text_source=audio_transcript`, and a Looki-specific `text_source_spec`.
- Preserve original Looki timestamps.
- Record the ledger method as `text_fallback`.
- Keep segment speaker/timing data in the bridge ledger/provider audit only; the public v1 Omi App import endpoint accepts text.

### Success Output

Store:

- Omi conversation id
- status when available from follow-up read
- discarded flag when available from follow-up read

### Memory Endpoint

The memory lane submits selected source text to Omi native memory extraction through Integration APIs.

```text
POST /v2/integrations/{app_id}/user/memories?uid={uid}
GET /v2/integrations/{app_id}/memories?uid={uid}
```

Payload fields:

- `text`
- `text_source`
- `text_source_spec`

Rules:

- Keep the event date out of the submitted memory body text where possible.
- Keep date/source tags and source hashes in the bridge ledger.
- Read existing memories before writing.
- Record whether rich metadata is actually backend-synced.
- Do not send both top-level `text` and explicit `memories[]` in the default hosted app path because that can create duplicates.

### Internal Developer API Boundary

Developer API-only capabilities are not part of public v1. Use them only for
local diagnostics or a future segmented import path after explicit user request.

Internal segmented import endpoint:

```text
POST /v1/dev/user/conversations/from-segments
```

Internal segmented payload rules:

- Use `source: "unknown"`.
- Do not use `source: "external_integration"` until Omi backend supports segmented external integration imports.
- Validate every segment has `end > start`.
- Send 1 to 500 transcript segments.
- Each segment should include `text`, `speaker`, `is_user`, `start`, and `end`; `speaker_id` and `person_id` are optional.
- Record the ledger method as `from_segments`.

### Rich Metadata Boundary

Confirmed surfaces:

- Python Developer API `/v1/dev/user/memories`: persists core fields only (`content`, `category`, `visibility`, `tags`).
- Python user-auth API `/v3/memories`: accepts the `Memory` request model, including `headline`, but `MemoryDB.from_memory()` does not carry `headline` or rich context fields into the stored object.
- Desktop Rust backend `/v3/memories`: has a richer request route for `confidence`, `source_app`, `context_summary`, `current_activity`, `source`, and `window_title`, but does not include `headline` in its create request model and should not be assumed to represent the current cloud Developer API contract.
- Local Omi SQLite: can render richer display fields, including `headline`, after local enrichment.

Treat local enrichment as display cache until backend persistence is confirmed on the exact endpoint used by the bridge.

### Failure Handling

- HTTP 500 is not success.
- Do not retry if the ledger already records a successful conversation id.
- For retryable network failure, keep state `failed` with `retryable=true`.
- Record the ledger method precisely so public v1 `text_fallback` imports are not confused with internal/future `from_segments` imports.
