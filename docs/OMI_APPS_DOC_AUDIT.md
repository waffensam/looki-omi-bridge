# Omi Apps Documentation Audit

Checked against Omi Apps documentation on 2026-05-04.

## Current App Type

Looki Omi Bridge is an External Integration app that uses Data Import APIs.

In scope for the first version:

- App home/setup UI
- Omi Integration Import APIs for conversations and memories
- Setup status endpoint
- OAuth callback support for reliable `uid` capture
- Private app testing before public submission

Out of scope for the first version:

- Prompt-based app prompts
- Omi live memory-trigger webhooks
- Omi real-time transcript webhooks
- Omi real-time raw audio byte streaming
- Chat tools manifest and tool endpoints
- Omi notifications or proactive chat messages
- Omi open-source `plugins/` packaging

## Page-by-Page Check

| Omi docs page             | Requirement                                                                                   | Current status | Notes                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Introduction              | Choose the right app type and test before submission.                                         | Covered        | This project maps to Integration Actions / Import external data into Omi.                                                                 |
| Prompt-Based Apps         | No server, Omi prompt customization.                                                          | Not applicable | We should not request prompt app capability for v1.                                                                                       |
| Integration Apps          | Hosted server, setup/auth URLs can receive `uid`; endpoints should return quickly.            | Mostly covered | We have setup UI, `/api/setup-status`, `/api/health`. We are not using trigger webhooks in v1.                                            |
| Real-Time Audio Streaming | Binary `application/octet-stream` endpoint for Omi device audio.                              | Not applicable | We import Looki audio files, not Omi live audio bytes. Do not request this capability yet.                                                |
| Data Import APIs          | App ID + app API key, user enables app, create/read conversations and memories.               | Covered        | Current Omi connector uses `/v2/integrations/{app_id}/user/conversations` and `/user/memories`.                                           |
| OAuth Authentication      | HTTPS App Home URL, OAuth `state`, callback receives `uid`, setup status can gate enablement. | Partly covered | `/api/oauth/start` and `/api/oauth/callback` now exist. Production still needs HTTPS and durable state/session storage if multi-instance. |
| Notifications             | Direct/proactive notification API and app secret.                                             | Not applicable | Do not request notification scope for v1.                                                                                                 |
| Publish Your App          | Test functionality, real data, errors; HTTPS; <5s endpoint response; accurate listing.        | Partly covered | Local smoke tests pass. Need hosted HTTPS private test and real import trial.                                                             |
| Open Source Your App      | Optional `plugins/` contribution shape.                                                       | Not applicable | This repo is a Next app, not ready for Omi `plugins/` packaging.                                                                          |
| App Setup                 | Omi Flutter app source setup.                                                                 | Not applicable | Useful only if changing Omi mobile/client source.                                                                                         |

## Submission Field Recommendation

For a private hosted test:

```text
App name: Looki Omi Bridge
Capability: External Integration
Imports: Create Conversations, Read Conversations, Create Memories, Read Memories
App Home URL: https://{host}/
Auth URL: https://{host}/api/oauth/start
OAuth Callback URL: https://{host}/api/oauth/callback
Setup Completed URL: https://{host}/api/setup-status
Health URL: https://{host}/api/health
```

Do not configure memory trigger, real-time transcript, raw audio, chat tools, or notifications until those flows are implemented.

## Remaining Before Public Submission

1. Deploy to HTTPS.
2. Use Supabase or another hosted durable store, not local JSON.
3. Set a production `APP_ENCRYPTION_KEY`.
4. Complete OAuth private test and confirm `uid` arrives through `/api/oauth/callback`.
5. Save Looki credentials for that `uid`; confirm `/api/setup-status?uid={uid}` returns `true`.
6. Import one memory-only moment and one audio conversation moment.
7. Verify created records in Omi and in the import ledger.
8. Add concise app listing copy, icon, privacy disclosure, and setup instructions.
