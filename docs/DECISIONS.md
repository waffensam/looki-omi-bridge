# Decisions

## D001: Use Omi API, Not Local SQLite

Status: accepted

Omi local SQLite is not the authoritative creation surface. Official conversation creation must use Omi APIs so backend processing can generate summaries, memories, tasks, folders, vectors, and sync state.

## D002: Ship Omi App V1 Through Integration Import APIs

Status: accepted

The public Omi App v1 will use `POST /v2/integrations/{app_id}/user/conversations?uid={uid}` as the canonical conversation import target because that is the Omi App / External Integration distribution path.

This path preserves transcript text and original Looki start/end timestamps, but it does not preserve full per-segment speaker/timing structure. The ledger must record this as `text_fallback`.

Developer API `POST /v1/dev/user/conversations/from-segments` remains an internal diagnostic or future/upstream-enhancement path only. It should not be required for the public Omi App v1.

## D003: Use Source Unknown

Status: accepted

Use:

```json
{ "source": "unknown" }
```

Do not use `external_integration` for internal segmented Looki imports. Current Omi processing treats `external_integration` as a text-source path and expects `text_source`, which segmented import payloads do not have.

This decision applies only to the internal/future segmented Developer API path. The public Omi App v1 uses Integration API text import instead.

## D004: ASR Provider Boundary

Status: accepted

Bailian Paraformer is the default ASR adapter because its official
`content_duration` contract bills only audio that is judged to contain speech
and still returns sentence/word timestamps on the original media timeline.

XFYun remains available through `ASR_PROVIDER=xfyun`, but it is a fallback
adapter. Current public XFYun docs document uploaded duration/original
duration, whole-file silence failure, and VAD-style segmentation controls; they
do not document an equivalent non-speech-not-billed contract.

## D005: No Developer API Requirement For Public V1

Status: accepted

The public Omi App v1 must not require Omi Developer API keys. It should use the app's Integration API key and the user's enabled app `uid` only.

If a local operator uses Developer API-only diagnostics, key creation is a setup/bootstrap operation only. Do not create keys during import runs.

## D006: Ledger Records Import Method

Status: accepted

The ledger must record the Omi write method:

- `from_segments`
- `text_fallback`
- `memory_create`

This matters because the 2026-04-28 validation samples were successfully imported via text fallback after `from-segments` failed with `source=external_integration`, and the ledger must not blur those outcomes.
For the public Omi App v1, `text_fallback` is the canonical method. `from_segments` is reserved for internal diagnostics or a future upstream-supported segmented app API.

## D007: Separate Conversation Lane And Memory Lane

Status: accepted

Looki audio recordings and Looki daily/multimodal events should not be forced into one Omi object.

Use the conversation lane when preserving transcript and timing is valuable. Use the memory lane when the durable output is a reusable fact, milestone, or commitment.

The two lanes share discovery, ASR, value gates, and ledger state, but they have separate payload contracts.

## D008: Dates Stay Out Of Memory Body

Status: accepted

Omi memory `content` should read like a reusable fact or experience, not like a dated diary sentence.

Use tags and ledger metadata for dates:

```text
looki_2026_05_03
```

## D009: Rich Memory Metadata Is Not Yet Cross-Device Reliable

Status: accepted

Omi Desktop supports rich memory metadata in local SQLite and the UI renders it. Current backend memory models do not preserve all rich fields across devices.

The current Python Developer memory API accepts only core fields (`content`, `category`, `visibility`, `tags`). The user-auth `/v3/memories` model accepts `headline`, but `MemoryDB.from_memory()` does not carry it into the stored object, and extra rich fields are ignored by that path. The desktop Rust backend has a richer route for `confidence`, `source_app`, `context_summary`, `current_activity`, `source`, and `window_title`, but that is not the bridge's default cloud contract.

The bridge may optionally enrich an already-created backend memory row locally for display parity, but the ledger must mark that state as cache-only. Backend schema support is required before claiming full multi-device rich sync.

## D010: Allow High-Confidence Moment Summary Auto Writes

Status: accepted

The first memory lane can auto-write high-confidence Omi memories from Looki moment title/description when the event is concrete, durable, non-routine, and non-speculative.

For You items are allowed as Looki-processed memory sources and as optional audio-review notes. They can explain why an audio moment matters and supply details for memory candidate generation. The UI should not force every For You item onto a moment; in the memory lane, For You and moments are separate selectable sources. They are not imported as conversations and should not be copied verbatim into memory content.

Targeted media analysis is not required for the first memory lane. Omi memory is a lightweight core record, so the bridge should use moment title/description plus sanitized For You content before considering any original media deep dive.

The memory gate must record evidence depth so later review can distinguish a memory created from Looki summary metadata from one created after deeper media analysis:

- `moment_summary`
- `for_you_enriched_summary`
- `targeted_media_required`
- `targeted_media`
- `user_review`

Routine meals, commuting, washing, casual browsing, weak safety guesses, temporary observations, and tasks without explicit future commitment remain `never_write` or `stage_only`.

## D011: Ship As Manual Omi App First

Status: accepted

The first usable product should be a private Omi App with a hosted connector backend and a simple manual import UI, not a local-only CLI.

The first app flow should:

- connect a Looki account by `base_url` and API key
- select a date
- fetch that day's Looki moments
- let the user select which moments to import
- write selected high-value moments to Omi memories
- transcribe selected audio moments and write them to Omi conversations
- record every outcome in the ledger so reruns are idempotent

The CLI remains useful as an internal debugging/operator surface, but it is not the product entrypoint.

Defer automatic daily sync, Omi chat tools, video/key-frame deep analysis, review queue, and public marketplace polish until the manual import app is reliable.

## D012: Keep AI Providers Pluggable

Status: accepted

ASR, OCR, and multimodal analysis work must sit behind provider adapters. The first public version uses managed Bailian ASR by default and should not bake that vendor into the domain model, ledger, or Omi payload contracts.

Provider modes:

- `managed`: the app uses the project's configured provider credentials
- `user_key`: the user brings their own provider API key
- `subscription`: the user pays for the app's managed provider usage

First version default: `managed`. `user_key` and `subscription` are planned account/pricing modes and must stay hidden from the public UI until the pricing, quota, support, and credential-storage boundaries are implemented.

The implementation must preserve a clean boundary for later `user_key` and `subscription` modes:

- store provider config per user, not globally in business logic
- encrypt user-supplied provider keys at rest
- never write provider keys to the ledger, logs, Omi, or Looki
- record provider name, model, request id/order id, and normalized output hashes in the ledger
- keep memory/conversation quality gates provider-neutral

External memory rewriting/gating is not part of public v1. The memory lane submits selected Looki source text to Omi native memory extraction; any future pre-filter/enrichment must stay optional and provider-neutral.
