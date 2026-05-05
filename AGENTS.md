# Looki Omi Bridge Agent Rules

These rules apply when working inside `looki-omi-bridge/`.

## Product Boundary

- Treat this project as an independent middleware workspace, not as Omi backend code.
- Do not modify Omi backend behavior from here. The bridge must work through public or existing user-facing APIs.
- The bridge's job is to transform Looki audio captures into Omi-compatible conversation imports and transform high-value Looki daily/multimodal events into Omi memory candidates with durable audit records.
- Do not write directly into Omi local SQLite as the source of truth. Local SQLite can be inspected for diagnosis, but official imports must go through Omi APIs.
- If local SQLite is used for temporary rich-memory display parity, only update rows that already have a backend memory id, mark the ledger entry as `sqliteCacheOnly`, and keep backend APIs as the authoritative creation surface.

## Security

- Never print raw API keys, refresh tokens, id tokens, or signed media URLs.
- Never commit real credentials. Use `.env.example` and local ignored config only.
- Before uploading private Looki audio to a third-party ASR provider, the user must have explicitly approved that provider and upload scope.
- Store raw audio only in temporary storage, and delete it after successful processing unless the user explicitly requests retention.
- Keep an import ledger with enough metadata to prevent duplicates, but do not store full raw audio in the ledger.

## Import Policy

- The public v1 product is an Omi App / External Integration app, so default writes must use the Omi Integration Import APIs, not Omi Developer API-only endpoints.
- The default conversation import target is `POST /v2/integrations/{app_id}/user/conversations?uid={uid}` and the ledger method is `text_fallback`.
- The default memory write target is `POST /v2/integrations/{app_id}/user/memories?uid={uid}` using text-only native Omi memory extraction.
- Developer API-only capabilities such as `POST /v1/dev/user/conversations/from-segments`, Developer memory CRUD, and local SQLite enrichment are internal diagnostics or future/upstream-enhancement paths only. Do not make them part of the public v1 Omi App flow unless the user explicitly asks.
- If the future segmented Developer API path is used, use `source: "unknown"` for imported Looki audio. Do not use `external_integration` unless the Omi backend is fixed to handle segmented external imports.
- Preserve original Looki `started_at`, `finished_at`, and timezone.
- Convert ASR speaker ids to Omi speaker labels such as `SPEAKER_00`.
- Default `is_user` to `true` for manual self recordings unless the diarization result proves otherwise. This currently affects only the internal/future segmented path because the public v1 Integration API accepts transcript text, not transcript segments.
- Use an idempotency key based on Looki moment id plus start time, not on mutable title text.
- For memory candidates, keep dates and provenance out of the memory body. Put date/source in ledger metadata and tags such as `looki_YYYY_MM_DD`.
- Do not auto-write every daily event. Default low-confidence or ordinary routine items to `stage_only` or `never_write`.

## Implementation Standards

- Prefer a service-oriented shape over one-off scripts:
  - connector adapters for Looki, ASR, and Omi
  - normalized domain models
  - import ledger
  - dry-run mode
  - explicit retry/error states
- Keep the core pipeline provider-agnostic. Bailian is the default ASR adapter, not a hard-coded global assumption.
- Bailian Paraformer is the current default ASR adapter; keep XFYun as a fallback adapter only.
- New commands must support dry-run and should not upload or write to Omi unless explicitly asked.
- When adding code, include focused tests for normalization, idempotency, and payload generation.

## Validation

- Validate generated Omi payloads against schemas before calling Omi.
- Verify imports by reading Omi API responses and recording conversation ids in the ledger.
- Treat HTTP 500 from Omi as a failed import, not a local success.
- Do not retry failed imports blindly if the failure could duplicate conversations.
