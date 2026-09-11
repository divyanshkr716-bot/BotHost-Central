-- Serverless webhook/runtime support.
-- This migration is intentionally additive: it does not drop or replace existing tables.

create extension if not exists pgcrypto;

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  update_id bigint not null,
  update_type text,
  payload jsonb,
  status text not null default 'received',
  error text,
  created_at timestamptz not null default now(),
  unique (bot_id, update_id)
);

create index if not exists webhook_events_bot_created_idx
  on public.webhook_events(bot_id, created_at desc);
create index if not exists webhook_events_update_idx
  on public.webhook_events(update_id);

-- The project already uses telegram_updates for idempotency. Keep the unique key
-- additive and make it safe to apply repeatedly.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'telegram_updates_bot_update_unique'
      and conrelid = 'public.telegram_updates'::regclass
  ) then
    alter table public.telegram_updates
      add constraint telegram_updates_bot_update_unique unique (bot_id, update_id);
  end if;
exception when undefined_table then
  raise notice 'telegram_updates is not present yet; existing project migration must create it first';
end $$;

-- Existing scheduled_deletions is retained. Add/ensure the operational indexes.
create index if not exists scheduled_deletions_due_idx
  on public.scheduled_deletions(status, delete_at);
create index if not exists scheduled_deletions_bot_idx
  on public.scheduled_deletions(bot_id, status);

-- Some existing code reads expires_at while the public contract calls it delete_at.
-- Keep both columns synchronized for rows created by this project.
do $$
begin
  if to_regclass('public.scheduled_deletions') is not null then
    alter table public.scheduled_deletions
      alter column expires_at set default now() + interval '45 seconds';
  end if;
end $$;

-- Cleanup execution can be triggered by Vercel Cron (1-minute cadence) or by
-- Supabase pg_cron (sub-minute cadence where enabled). No process/timer is kept alive.
