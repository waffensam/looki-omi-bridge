# Architecture

## Intent

Looki Omi Bridge should become a small middleware layer between personal capture systems and Omi's memory system.

The project should ship as an Omi App first, while preserving a core that can be run from local operator commands for debugging. It should be suitable for:

- private Omi App manual import
- hosted connector worker
- local operator CLI for debugging and recovery
- future MCP/tool wrapper

## System Boundary

```text
Looki API
  |
  v
Looki Connector
  |
  v
Hosted Connector Backend ---- Import Ledger
  |
  +--> Provider Registry
  |     +--> ASR Adapter: Bailian by default, XFYun fallback
  |     +--> Optional OCR/Multimodal Adapters
  |
  +--> Conversation Normalizer
  |
  +--> Conversation Value Gate -> Omi Conversation Import
  |
  +--> Memory Source Builder
  |
  +--> Omi Native Memory Extraction
  |
  +--> Optional Local Enrichment
  |
  v
Omi Connector -> Omi APIs
```

The first user-facing surface is a manual import web app opened from Omi:

```text
Omi App Home
  -> Looki credential setup
  -> Date picker
  -> Moment list
  -> Import selected as Memory or Conversation
  -> Result/ledger status
```

## Domain Objects

### LookiAudioMoment

Minimal unit fetched from Looki.

- `id`
- title and description
- start/end time with timezone
- audio media metadata
- temporary media URL

The temporary URL is never written to durable logs.

### NormalizedTranscript

Provider-neutral ASR output.

- full text
- segments
- provider order id
- provider name

### OmiConversationImport

The first app conversation write path.

- transcript text
- original `started_at` / `finished_at`
- language
- `text_source` / `text_source_spec`

The segment-preserving `OmiFromSegmentsPayload` remains in contracts and schemas for internal diagnostics and a future upstream Integration API enhancement. It is not required for the public Omi App v1.

### LookiMemoryCandidate

The canonical memory write candidate.

- date-free memory body
- event date in metadata and tags
- source Looki moment ids
- confidence and evidence
- write policy: `auto_write`, `stage_only`, or `never_write`
- optional context summary and headline for rich display

### ImportLedgerRecord

Durable import state. This is the project's source of idempotency.

The ledger records decisions and outcomes for both conversation and memory targets, not raw audio or signed media URLs.

Conversation records must also record the Omi write method (`text_fallback` for public v1, `from_segments` only for internal/future segmented paths).

Provider records must include provider name, model, request/order id when available, and normalized output hashes. They must never include API keys, refresh tokens, signed media URLs, raw audio, or full video payloads.

### ProviderConfig

Per-user provider configuration.

- mode: `managed`, `user_key`, or `subscription`
- ASR provider
- OCR/multimodal provider
- optional encrypted user-owned API key references

The first version only exposes the managed default in the UI. `user_key` and `subscription` stay hidden until pricing, quota, support, and credential-storage boundaries are implemented.

## Pipeline Stages

### 1. Discover

Fetch Looki moments by date or range, filter to audio moments, and build idempotency keys.

### 2. Plan

Compare candidates against ledger. Generate an import plan with `planned`, `skip`, or `review` decisions.

### 3. Fetch Audio

Download only planned audio to a temp directory. Do not persist signed URLs.

### 4. Transcribe

Upload audio to the selected ASR provider. Bailian Paraformer is the initial managed adapter; XFYun is kept as a fallback.

### 5. Normalize

Convert provider-specific output into `NormalizedTranscriptSegment` values.

### 6. Gate Conversation Imports

Avoid importing obvious noise or duplicate trivial fragments. The initial gate should be conservative and explainable.

### 7. Import Conversation

Call Omi `POST /v2/integrations/{app_id}/user/conversations` with transcript text. This is the Omi App-compatible first version.

### 8. Build Memory Candidates

Use the same evidence stream when useful, but do not require every conversation import to become a memory.

Good memory sources are durable facts, meaningful personal milestones, or explicit user commitments. Routine daily activities should not be submitted by default.

The hosted app default should not generate final memory text itself. Submit the
selected Looki source text to Omi's native memory extraction so Omi owns wording,
dedupe, and style. External memory rewriting/gating is not part of public v1.

### 9. Submit Memory Source

Call the Omi Integration memory API with text-only source payload:

- `text`
- `text_source`
- `text_source_spec`

### 10. Optional Local Enrichment

Current Omi Desktop supports rich memory display fields locally:

- `confidence`
- `sourceApp`
- `contextSummary`
- `currentActivity`
- `windowTitle`
- `headline`

Current Python Developer API memory writes do not preserve these fields. User-auth `/v3/memories` also does not reliably persist `headline` or rich context through `MemoryDB.from_memory()`. Local enrichment is therefore cache-only until Omi backend schema supports cross-device rich memory metadata on the chosen endpoint.

### 11. Record

Update the ledger with Omi conversation id, memory id, local enrichment state, or failed state.

## Why Not Local SQLite

Omi Desktop local SQLite is a cache and UI/runtime state store. Official conversation processing, memory extraction, task extraction, folder assignment, vector indexing, and cross-device sync happen through backend APIs.

Writing local rows directly would create records Omi may not recognize as authoritative. The bridge should only use local SQLite for diagnosis, read-only validation, or optional enrichment of an already-created backend memory row.
