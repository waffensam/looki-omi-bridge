# Implementation Plan

## Phase 0: Contracts

Status: started

- Project docs
- Agent rules
- Type contracts
- JSON schemas
- Example payloads
- Memory lane contracts and candidate schema

## Phase 1: Offline Core

Build without network calls first.

- ledger reader/writer
- idempotency key generation
- Bailian result parser and XFYun fallback parser using saved examples
- Omi Integration API payload normalizer
- Omi memory payload builder
- memory value gate with evidence depth
- provider adapter interfaces and managed provider config shape
- schema validation
- dry-run report generation

Acceptance:

- saved ASR result can produce a valid Omi Integration API payload
- saved Looki daily event can produce a date-free Omi memory payload
- strong saved Looki moment summary can produce an `auto_write` memory candidate with `evidenceDepth=moment_summary`
- ambiguous saved Looki moment summary can produce `stage_only` with `evidenceDepth=targeted_media_required`
- provider decisions are recorded without storing provider keys
- duplicate ledger entries are skipped
- invalid segment timestamps fail validation
- date-prefixed memory content fails validation

## Phase 2: App Shell And Read Connectors

Add the manual Omi App shell and Looki read-only discovery.

- app setup page
- date picker and moment list
- credential loading
- base URL verification
- sanitized logging
- audio candidate discovery

Acceptance:

- user can configure Looki credentials without printing secrets
- date discovery prints audio candidates without signed URLs
- no audio upload occurs in dry-run

## Phase 3: Controlled Import

Add single-item real import.

- temporary audio download
- Bailian upload/submission and polling
- Omi Integration API conversation text import
- Omi memory core write
- `memory-write-one` and `memory-write-date` commands
- ledger update
- temp audio cleanup

Acceptance:

- one selected audio candidate imports into Omi conversation
- one selected memory candidate writes into Omi with date stored in tags
- high-confidence date run can auto-write eligible memory candidates while staging ambiguous candidates
- Omi conversation id is recorded
- Omi memory id is recorded
- rerun skips the same candidate
- Developer API-only segmented import remains outside public v1

## Phase 4: Daily Job

Add daily incremental import after manual runs are reliable.

- previous-day date selection
- retry policy
- summary report
- optional user review mode

Acceptance:

- daily run produces a compact report
- failures are retryable but not duplicated
