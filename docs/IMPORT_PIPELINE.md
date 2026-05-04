# Import Pipeline

## Default Daily Run

The daily run has two possible lanes:

- conversation lane: imports selected Looki manual audio moments into Omi conversations
- memory lane: writes high-value Looki daily/multimodal events into Omi memories

```text
date = yesterday in user's Looki timezone
```

## Stages

The hosted app does not run long imports inside the browser-triggered HTTP
request. `POST /api/import` writes one ledger-backed job per selected target and
returns immediately. A background worker then advances each job through:

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

Run the worker with:

```bash
npm run worker
```

For a one-shot local or VPS cron-style run:

```bash
npm run worker:once
```

The worker uses Supabase `import_ledger` as the durable job source. Jobs in
`processing` can be picked up again after `IMPORT_WORKER_STALE_PROCESSING_MS`,
so a crashed worker does not permanently hide the import.

### 1. Candidate Discovery

For the conversation lane, fetch Looki moments for the target date and select:

```text
media_types contains AUDIO
```

Each candidate gets:

```text
idempotency_key = looki:conversation:{moment_id}:{start_time}
```

For the memory lane, build event clusters from daily timeline, targeted media, OCR, and ASR evidence:

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
xfyun recording-file ASR large model
```

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

## Memory Lane

The memory lane starts after discovery and targeted evidence gathering.

### Candidate Rules

- `content` must not start with a date.
- `eventDate` and `looki_YYYY_MM_DD` tags carry the date.
- `sourceMomentIds` preserve provenance.
- `contextSummary` explains why the memory exists.
- `confidence >= 0.85` is required for `auto_write`.

### Omi Memory Write

Write core memory data through the Omi Integration API first.

```json
{
  "content": "用户陪孩子在迪卡侬挑选并调试过儿童自行车，并一起完成了离店骑行和夜间试骑。",
  "visibility": "private",
  "category": "manual",
  "tags": ["looki", "looki_daily", "looki_2026_05_03", "family_milestone"]
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
