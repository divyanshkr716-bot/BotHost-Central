# BotHost Central — Universal Webhook Upgrade

This package is an upgraded source baseline for the current BotHost Central website.

## Included
- One bot ZIP upload workflow
- Server-side ZIP safety analysis
- Manifest-aware runtime detection
- Automatic webhook registration and verification
- Public Telegram webhook endpoint with secret-token verification
- Duplicate update protection using `telegram_updates`
- Bot-specific runtime isolation
- Existing Flix runtime, media indexing, auto-delete and dashboard preserved
- Static adapter-plan replies disabled; the platform no longer pretends that a literal reply extracted from source is the bot's real handler
- Deployment/logging/health flow retained

## Important runtime boundary
The web application cannot safely execute arbitrary uploaded Node/Python source directly inside a serverless request. This source therefore uses trusted platform adapters and explicitly refuses to fake dynamic handlers as static replies. To support arbitrary uploaded code, deploy a separate isolated build/worker sandbox and connect it to the runtime manager; that worker is not silently fabricated by this ZIP.

## Required environment
See `.env.example`. Never put Telegram tokens or Supabase service-role keys in source control.

## Database
The existing Supabase schema must contain the tables used by the current application, including `bots`, `bot_credentials`, `bot_projects`, `bot_project_versions`, `telegram_updates`, `runtime_logs`, `bot_webhooks`, `storage_channels`, and the existing Flix/auto-delete tables.

## Serverless deployment additions

- `vercel.json` provides a serverless deployment configuration and a minute-level cleanup fallback.
- `supabase/migrations/202609110001_serverless_webhook_runtime.sql` adds webhook event storage/idempotency and deletion indexes.
- `SERVERLESS_DEPLOYMENT.md` documents the real serverless boundary, the 45-second scheduling limitation, and the Telethon user-session limitation.
- Cleanup accepts a private `CRON_SECRET` for scheduler calls.

Exact 45-second deletion is a target timestamp, not a guaranteed wall-clock promise on Vercel Cron. A sub-minute scheduler such as Supabase pg_cron/pg_net can reduce the delay, but Telegram/network/database latency still means exact-to-the-second timing cannot be guaranteed.

## Hybrid storage backup
- Supabase Storage is used for project archives when available.
- Every eligible project archive is also mirrored to the bot's verified Telegram storage channel.
- If Supabase Storage fails and Telegram storage succeeds, Telegram becomes the recorded primary provider for that archive.
- Telegram backup metadata (chat/message/file IDs and status) is stored in `bot_project_versions`.
- Hosted Telegram Bot API document uploads are currently limited to 50 MB; larger archives cannot be mirrored through the standard hosted Bot API. citeturn0search0
