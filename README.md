# Looki Omi Bridge

Looki Omi Bridge is an Omi App plus connector backend for importing Looki manual audio captures into Omi conversations and for writing high-value Looki daily/multimodal events into Omi as durable memories.

This is not a one-off local script. The first version is a manual import app; the same core can later support automation, chat tools, and richer provider choices without patching Omi backend code.

## Current Decision

The first shipped surface is a manual Omi App flow:

```text
open app from Omi
  -> capture or restore the current Omi uid
  -> save Looki base_url/API key for that uid
  -> pick a date
  -> select moments
  -> import selected Memory and/or 录音会话
  -> inspect ledger
```

The bridge has two lanes.

Conversation lane:

```text
Looki AUDIO moment
  -> temporary audio download
  -> Bailian Paraformer recording-file ASR
  -> normalized transcript segments
  -> Omi App Integration API conversation text import
```

The first app version uses the Omi Integration API because it fits the Omi App distribution model. This preserves transcript text and original timestamps, but not full speaker/timing segments. Developer API-only segment imports are not part of public v1; if segment fidelity becomes a hard requirement, add a segmented Integration API upstream or keep Developer API `from-segments` as an internal diagnostic path.

Memory lane:

```text
Looki daily timeline / targeted audio-video evidence
  -> observation evidence
  -> event cluster
  -> value gate
  -> Omi memory candidate
  -> Omi App Integration API memory write
  -> ledger metadata
```

The memory body must be reusable without a date prefix. Date, source, source moments, and confidence belong in tags, ledger fields, and optional rich metadata.

The default memory write endpoint for the app is `POST /v2/integrations/{app_id}/user/memories`. The memory body stays date-free; tags and ledger metadata carry provenance.

## Run

```bash
npm install
cp config/.env.example .env.local
npm run dev
```

For local-only testing the app uses `data/app-store.json`. For hosted use, create the tables in `supabase/schema.sql` and set `SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY`.

## Non-Goals

- Do not modify Omi backend.
- Do not require Omi Developer API keys for the public Omi App v1 flow.
- Do not write official conversations directly into Omi local SQLite.
- Do not treat local SQLite enrichment as cross-device sync.
- Do not permanently store raw Looki audio.
- Do not import every captured audio fragment without user selection, filtering, and idempotency.
- Do not expose future provider billing modes in the public UI until pricing and account boundaries are implemented.

## Target Shape

The project should grow into these modules:

```text
Looki connector       fetch AUDIO moments, daily timeline events, and temporary media
ASR adapter           transcribe audio into normalized segments
Normalizer            map provider output to Omi transcript segments
Value gate            decide import / skip / review
Memory gate           decide auto_write / stage_only / never_write
Omi connector         import conversations and write memory core records
Ledger                prevent duplicates and track outcomes
Scheduler             daily incremental run
```

## First Conversation Workflow

1. Fetch Looki moments for a date range.
2. Select `media_types` containing `AUDIO`.
3. Compute idempotency key: `looki:conversation:{moment_id}:{start_time}`.
4. Skip records already imported or explicitly skipped.
5. Download audio to process memory only.
6. Upload only approved audio to the configured ASR provider.
7. Normalize ASR output into provider-neutral segments.
8. Import transcript text via `POST /v2/integrations/{app_id}/user/conversations`.
9. Record method as `text_fallback`.
10. Write final state to the ledger.
11. Remove temp audio.

## First Memory Workflow

1. Fetch Looki moments and/or the daily timeline.
2. Select high-value clusters, not every routine moment.
3. Use targeted media analysis only when it can raise confidence or extract decisions/commitments.
4. Build `LookiMemoryCandidate`.
5. Validate against `schemas/omi-memory-candidate.schema.json`.
6. Compare against ledger-backed existing memory content.
7. Write only `writePolicy=auto_write` candidates.
8. Store dates in tags such as `looki_2026_05_03`, not in the memory body.
9. Record Omi memory id and whether rich metadata is backend-synced or local-cache-only.

For implementation handoff, use `docs/HANDOFF_LOOKI_MEMORY_FORMAT.md` as the canonical Looki -> Omi memory format guide.

## Internal Segmented Import Payload

The schema remains in the repo for internal diagnostics and a future segment-preserving path. It is not part of the public Omi App v1 flow:

```json
{
  "source": "unknown",
  "language": "zh",
  "started_at": "2026-04-28T08:42:12.470000+08:00",
  "finished_at": "2026-04-28T08:42:37.759000+08:00",
  "transcript_segments": [
    {
      "text": "今天晚上别忘了拿快递。",
      "speaker": "SPEAKER_00",
      "is_user": true,
      "start": 0.0,
      "end": 3.2
    }
  ]
}
```

## Workspace Layout

```text
looki-omi-bridge/
  AGENTS.md
  README.md
  docs/
  schemas/
  templates/
  src/
  config/
```

`src/` contains the Next app, network clients, provider adapters, shared contracts, and ledger storage implementations.

## Verified Trial Notes

Read [VERIFIED_FINDINGS.md](docs/VERIFIED_FINDINGS.md) before implementing network calls. It records historical XFYun validation, the Omi text fallback import results, and the reason `source: "external_integration"` failed for segmented Developer API imports. The current default ASR provider is Bailian Paraformer.
