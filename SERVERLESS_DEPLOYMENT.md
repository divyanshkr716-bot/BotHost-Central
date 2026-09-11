# Serverless Webhook Deployment

## Runtime model

Telegram -> `/api/public/telegram/webhook/:botId` -> serverless function -> Telegram Bot API -> function ends.

There is no Telegram polling loop, `app.listen()`, `setInterval()`, PM2 process, or `run_until_disconnected()` in the webhook runtime.

## Vercel

Import the GitHub repository into Vercel and set:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `PUBLIC_APP_URL`
- `CRON_SECRET`

The included `vercel.json` calls the cleanup endpoint once per minute. This is a fallback scheduler; it does **not** guarantee deletion at exactly 45.000 seconds.

## 45-second deletion reality

The target is stored as `delete_at = created_at + 45 seconds` in Supabase. Deletion is idempotent and processed when the scheduler sees `delete_at <= now()`.

A normal Vercel Cron schedule has minute-level cadence, so exact 45-second wall-clock deletion cannot be honestly guaranteed by Vercel Cron alone. If your Supabase project has `pg_cron`/`pg_net` enabled, use a sub-minute database schedule to reduce the delay; the database remains the source of truth.

Never use `setTimeout` or `setInterval` as the deletion mechanism.

## Telegram webhook

When a bot is deployed/enabled, the bot service registers:

`https://YOUR_DOMAIN/api/public/telegram/webhook/<BOT_ID>`

The webhook handler validates Telegram's secret header, deduplicates `update_id`, loads the selected bot/project, runs the trusted runtime, and records the result.

## Source bot -> destination channel

The supplied `forward_video.py` uses a Telethon **user session** and `run_until_disconnected()`. A normal Telegram Bot API webhook cannot receive arbitrary private messages sent from another bot account in the way that Telethon can.

Therefore this project does not fake that functionality. It can forward/copy media that is actually delivered to the webhook and permitted by the Bot API (for example supported channel posts), but the exact `@Movie4unew_bot` -> `@Flixgoooo` user-session workflow requires a persistent MTProto/user-session worker or a change in the source workflow.

## Important runtime boundary

Uploaded arbitrary Node/Python source is not executed directly inside the webhook request. The current platform uses a trusted runtime/adapter boundary. Unsupported long-running/polling/user-session projects are reported instead of being falsely marked LIVE.
