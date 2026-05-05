# Middleware And Plugin Preparation

## Why This Is A Middleware Project

The bridge touches three systems with separate security and product semantics:

- Looki owns personal media capture.
- ASR providers transform raw audio into text.
- Omi owns memory, task, and conversation processing.

Combining these as one local script would make it hard to audit uploads, prevent duplicates, rotate keys, or later turn the flow into a user-facing integration. The middleware boundary keeps each responsibility explicit.

## Future Packaging Options

Recommended path:

```text
private Omi App -> hosted connector backend -> optional chat tools / automation / public listing
```

The Omi App manual import flow is the first product. A local CLI can still exist as an internal operator/debugging surface over the same provider-neutral core.

### Local CLI

Internal debugging and recovery surface.

Capabilities:

- `discover`
- `dry-run`
- `import-one`
- `import-date`
- `memory-plan-date`
- `memory-write-one`
- `memory-write-date`
- `ledger inspect`

### Local Agent Tool

Expose the pipeline as a tool callable by Codex or another local agent.

Requirements:

- never return secrets
- always support dry-run
- return structured import summaries

### Omi External Integration

Longer-term option once the product shape is stable.

Requirements:

- server-side credential storage
- user consent for Looki and ASR
- official import status UI
- retry and duplicate handling

### Omi Plugin

First product surface:

- "Import yesterday's Looki recordings"
- "Review yesterday's Looki memory candidates"
- "Write high-confidence Looki memories"
- review queue
- import ledger
- provider settings

This should call the hosted connector backend rather than embedding all provider logic in UI code.

## Minimum Viable Middleware

The first useful app version should be manual, not fully automated.

It should support:

1. configure Looki credentials in the app setup page
2. discover a date from the app UI
3. dry-run
4. import selected memory candidates
5. transcribe and import selected audio conversations
6. record the result

Only after those are reliable should daily scheduling be added.

## Operational Defaults

- target date: previous day
- Omi conversation endpoint: `/v2/integrations/{app_id}/user/conversations`
- Omi memory endpoint: `/v2/integrations/{app_id}/user/memories`
- Omi write method: `text_fallback` for public v1 conversations
- Omi memory source text: date-free where possible; date/provenance stays in ledger metadata
- ASR provider: Bailian Paraformer
- AI provider mode: managed
- Looki media: `AUDIO` moments only
- memory auto-write: allowed for high-confidence concrete Looki moment summaries
- raw audio retention: temp only
- duplicate protection: ledger required
- Developer API-only segmented import: internal/future path, not public v1
