# Agent Workflows

Use these role notes when delegating work inside this project.

## Connector Engineer

Owns provider adapters.

Responsibilities:

- Looki read connector
- XFYun ASR adapter
- Omi API connector
- credential loading without secret logging
- provider-specific error parsing

Must not:

- change import policy
- bypass the ledger
- write direct Omi SQLite rows

## Pipeline Engineer

Owns the provider-neutral core.

Responsibilities:

- idempotency key generation
- ledger reader/writer
- transcript normalization
- Omi payload generation
- schema validation
- dry-run report

Must not:

- perform real uploads in unit tests
- couple core logic directly to XFYun or Looki response shapes

## Import Operator

Owns safe manual and scheduled runs.

Responsibilities:

- run dry-run first
- import one candidate before batch runs
- inspect ledger
- report Omi conversation ids
- clean temporary audio

Must not:

- create a new Developer API key per run
- re-import already imported candidates
- print raw tokens or signed URLs

## Reviewer

Owns risk review before automation.

Checklist:

- Does every write path update the ledger?
- Does dry-run avoid all ASR and Omi writes?
- Are signed URLs and secrets redacted?
- Is `source` fixed to `unknown` for from-segments?
- Can a failed run be safely resumed?
