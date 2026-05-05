# Runbook

## Setup

1. Create `.env.local` from `config/.env.example`.
2. Fill `OMI_APP_ID` and `OMI_APP_API_KEY` from the Omi App configuration.
3. Fill XFYun credentials for first-version recording imports.
4. Fill `MANAGED_OPENAI_API_KEY` if managed LLM memory gating should use OpenAI; otherwise the app falls back to deterministic rules.
5. For hosted runs, create the Supabase tables in `supabase/schema.sql`; local runs can use `data/app-store.json`.
6. Save Looki `base_url` and API key in the app UI for each Omi uid.

## Manual Validation Sequence

### Step 1: Discover

Fetch a target date and print sanitized candidates:

- moment id
- title
- start/end time
- audio duration
- media type

Do not print signed audio URLs.

### Step 2: Dry Run

Generate planned imports without uploading audio.

Expected output:

- planned count
- skipped duplicate count
- review count

### Step 3: Single Import Trial

Run exactly one selected candidate through:

```text
Looki -> XFYun -> normalize -> Omi Integration conversation import
```

Expected app behavior: the write call succeeds, then the app reads recent integration conversations and records the matched conversation id when available.

Use a fresh candidate for this trial. Do not reuse the 2026-04-28 08:42 or 08:43 samples unless you intentionally want duplicates; those were already imported through text fallback during validation.

### Step 4: Ledger Check

Confirm the ledger contains the Omi conversation id and import timestamp.

### Step 5: Omi Verification

Read the imported conversation by Omi API and confirm:

- title or overview exists
- transcript is present
- timestamps are plausible
- not discarded unless expected

## Omi App Private Test Sequence

Use this before switching the Omi app from Private to Public.

### Step 1: Configure App Fields

- App Home URL: `${APP_HOME_URL}`.
- Auth URL: `${OMI_AUTH_URL}`.
- OAuth Callback URL: `${OMI_OAUTH_CALLBACK_URL}`.
- Setup Completed URL: `${SETUP_COMPLETED_URL}`.
- Capabilities: External Integration with Import conversations and Import memories.
- Use HTTPS for any device/Omi-hosted test. Localhost is only for Codex/browser smoke tests.

### Step 2: Endpoint Smoke Test

Expected responses:

```text
GET /api/health -> 200 in less than 5 seconds
GET /api/setup-status?uid={uid} -> {"is_setup_completed": true|false}
GET /api/oauth/start -> 302 to Omi OAuth when OMI_APP_ID is configured
```

`setup-status` should return `false` until the user has saved a Looki profile in the app UI.

### Step 3: Private User Flow

1. Enable the private app in Omi Developer Mode.
2. Open the app setup/auth link from Omi once and confirm the page either receives `uid` in the query string or restores a previously remembered UID.
3. On macOS, the Open button may open the bare App Home URL. The bridge should restore the last remembered UID in the same browser; if no UID has been remembered yet, use the visible “从 Omi 授权连接” action or paste the UID manually.
4. Save Looki credentials for that `uid`.
5. Recheck `setup-status`; it should return `true`.
6. Import one memory-only moment.
7. Import one audio conversation moment.
8. Verify both in Omi and in this app's ledger.

### Step 4: Error Handling

Check these cases before public submission:

- missing `uid` returns a non-secret error in profile/moment/import APIs
- invalid Looki key fails setup without printing the key
- missing Omi or ASR env vars show status warnings
- duplicate imports skip through ledger idempotency

## Memory Validation Sequence

### Step 1: Build Candidate

Create a `LookiMemoryCandidate` from daily timeline and targeted evidence.

Required checks:

- content has no date prefix
- `eventDate` is set
- `looki_YYYY_MM_DD` tag will be generated
- `confidence >= 0.85` for `auto_write`

### Step 2: Read Existing Omi Memories

Use Omi memory read API before writing.

Skip or stage if an existing memory already covers the same fact.

### Step 3: Write Core Memory

Write memory through `POST /v2/integrations/{app_id}/user/memories`:

```json
{
  "text_source": "other",
  "text_source_spec": "Looki selected memory candidate",
  "memories": [
    {
      "content": "用户重视陪孩子参与户外活动。",
      "tags": ["looki", "looki_daily", "looki_2026_05_03", "family_milestone"]
    }
  ]
}
```

Do not include date or source prose in the memory body. Do not send `contextSummary` as top-level `text` when using explicit `memories[]`; that would turn local/ledger context into a second extraction source. Keep `headline`, `context_summary`, evidence depth, provider audit, and source moment ids in the candidate and ledger layer.

### Step 4: Optional Local Enrichment

If local Omi Desktop display parity is later needed, enrich only the local row that already has the returned backend memory id.

Record in ledger:

```json
{
  "omi": {
    "richMetadataSynced": false
  },
  "local": {
    "enriched": true,
    "sqliteCacheOnly": true
  }
}
```

### Step 5: Cross-Device Check

Treat rich metadata as not synced unless the backend response returns the same fields on a clean fetch.

## Failure Playbook

### XFYun `language verify fail`

Use:

```text
language=autodialect
```

Do not use `language=cn`.

Also ensure `duration` is sent in milliseconds, matching the current XFYun recording-file ASR large model WebAPI behavior.

### Omi 500 From Segments

This applies only to the future Developer API segment-preserving path, not the first Omi App import path. Check source value first.

Known bad value:

```json
{ "source": "external_integration" }
```

Known intended value:

```json
{ "source": "unknown" }
```

Root cause observed from local upstream code: `source=external_integration` routes `process_conversation` into the text-source branch and attempts to read `conversation.text_source`. The `from-segments` endpoint builds a segmented `CreateConversation`, which does not have `text_source`, so the backend returns a generic 500.

For already imported samples, do not retry through a different method unless the duplicate is desired. Mark the ledger method precisely:

- `from_segments`
- `text_fallback`
- `memory_create`

### Duplicate Concern

Do not re-import manually. Inspect ledger first.

If a conversation was imported through the wrong path, mark the ledger entry with the existing conversation id and do not create another one.

For memories, prefer keep/patch/skip over creating another memory with slightly different wording.

## Key Rotation

Rotate credentials if they were pasted into chat or logs.

After rotation:

1. update local config
2. run dry-run
3. run one single import trial
