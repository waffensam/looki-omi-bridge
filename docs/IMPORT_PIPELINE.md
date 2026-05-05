# Import Pipeline

## Default Daily Run

The daily run has two explicit lanes:

- conversation lane: imports selected Looki manual audio moments into Omi conversations
- memory lane: writes high-value Looki daily/multimodal events into Omi memories

Looki For You is never imported as a conversation. In the conversation lane it
is only an optional user-facing description that helps identify relevant audio.
In the memory lane, For You and moments are separate selectable sources. The UI
does not force cross-matching between them. Selected sources are submitted as
text to Omi's native memory extraction.

```text
date = yesterday in user's Looki timezone
```

## Stages

The hosted app does not run long imports inside the browser-triggered HTTP
request. `POST /api/import` writes one ledger-backed job per selected target,
starts a Vercel Workflow run, and returns immediately. The Workflow step then
advances each job through:

```text
queued
  -> processing/looki
  -> processing/audio_lookup | memory_gate
  -> processing/audio_download
  -> processing/asr_upload
  -> processing/asr_poll
  -> processing/omi_write
  -> imported | skipped | failed
```

Vercel Workflow is the default hosted execution path. It is configured through
`workflow` and `withWorkflow()` in `next.config.ts`.

The local Node worker is kept as a diagnostic or VPS fallback. Run it with:

```bash
npm run worker
```

For a one-shot local or VPS cron-style run:

```bash
npm run worker:once
```

Both Vercel Workflow and the fallback worker use Supabase `import_ledger` as the durable job source. Jobs in
`processing` can be picked up again after `IMPORT_WORKER_STALE_PROCESSING_MS`,
so a crashed worker does not permanently hide the import.

### 1. Candidate Discovery

For the conversation lane, fetch Looki moments for the target date and select:

```text
media_types contains AUDIO
```

Read sanitized For You items for the same date. If a For You `MOMENT_POST`
strongly describes an audio moment, show it as a UI note only. Do not use For
You text as conversation content; conversation content still comes from raw
audio ASR.

Each candidate gets:

```text
idempotency_key = looki:conversation:{moment_id}:{start_time}
```

For the memory lane, selectable source ids can be either `moment:{id}` or
`for_you:{id}`. Moment jobs start from moment title/description. For You jobs
start from sanitized For You content. If the user selects both, selected For You
ids are stored in the queued moment job as additional Omi source text rather
than inferred by hidden matching.

```text
idempotency_key = looki:memory:{event_date}:{event_type}:{stable_source_id}
```

### 2. Ledger Check

Skip candidates already marked:

- `imported`
- `skipped`

Allow retry for:

- `failed` with `retryable=true`

### 3. Audio Download

Download to temp storage only.

Recommended filename:

```text
{date}/{start_time}_{moment_id}.m4a
```

Do not store signed URLs in ledger or logs.

### 4. ASR

Upload to the configured ASR provider.

Initial provider:

```text
Bailian Paraformer recording-file ASR
```

Bailian is the default because Paraformer explicitly reports
`content_duration` for speech-only metering while preserving original
sentence/word timestamps. XFYun remains available through
`ASR_PROVIDER=xfyun`, but current public docs do not show an equivalent
non-speech-not-billed contract.

For each completed ASR run, persist usage fields in the ledger:

- `asr.model`
- `asr.originalDurationMs`
- `asr.billableSpeechMs`
- `asr.estimatedCostUsd`
- `asr.billingUnitPriceUsdPerSecond`

The ledger API should aggregate the current month's ASR usage from those fields.

### 5. Normalize

Create provider-independent transcript segments.

Rules:

- trim empty text
- coerce speaker to `SPEAKER_XX`
- default missing timestamps to a monotonic range
- reject segment when `end <= start`

### 6. Conversation Value Gate

The bridge should not import obvious junk. Initial rules can be simple:

Import when transcript contains one of:

- reminder
- task
- commitment
- decision
- question or thought worth revisiting
- family/work arrangement

Skip when:

- transcript is empty
- transcript is only filler words
- transcript is a duplicate of an already imported nearby moment

When unsure, mark `review`.

### 7. Omi Conversation Import

First app version calls `POST /v2/integrations/{app_id}/user/conversations` with transcript text, original start/end time, and a `text_source_spec` that points back to Looki. Record the ledger method as `text_fallback`.

The segment-preserving Developer API payload remains the future fallback when speaker/timing fidelity is required. That path must use `source: "unknown"`.

### 8. Ledger Update

Record final state.

Successful import:

```json
{
  "status": "imported",
  "omi": {
    "conversationId": "..."
  }
}
```

For Omi App Integration imports, `conversationId` is best-effort. The v2
create endpoint returns `{}` and creates the conversation asynchronously, so a
readback timeout must not turn a successful write into `failed`.

## Memory Lane

The memory lane starts after discovery and targeted evidence gathering.

### Candidate Rules

- `content` must not start with a date.
- `eventDate` and `looki_YYYY_MM_DD` tags carry the date.
- `sourceMomentIds` preserve provenance.
- `contextSummary` explains why the memory exists.
- `confidence >= 0.85` is required for `auto_write`.

### Omi Memory Write

Submit selected memory source text through the Omi Integration API and let Omi
apply its native memory extraction. Do not send `memories[]` in the default
hosted app path because Omi will also extract from top-level `text`.

```json
{
  "text": "标题：家的暖色时光\n摘要：和家人一起在家中欣赏城市夜景。",
  "text_source": "other",
  "text_source_spec": "looki:2026-05-04:for_you:example"
}
```

Optional rich display metadata can be applied locally only after a backend memory id exists. Record it as `sqliteCacheOnly` until Omi backend persists the same fields.

Failed import:

```json
{
  "status": "failed",
  "error": {
    "stage": "omi",
    "message": "...",
    "retryable": true
  }
}
```

## Dry Run

Dry run must show:

- candidates found
- duplicate/skipped/import decisions
- memory auto_write/stage_only/never_write decisions
- normalized Omi payload preview

Dry run must not:

- upload audio to ASR
- call Omi write APIs
- create Omi API keys
