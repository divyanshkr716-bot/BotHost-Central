-- Hybrid project archive storage. Supabase remains primary when available;
-- verified Telegram storage is a mirror and overflow/fallback store.

alter table if exists public.bot_project_versions
  add column if not exists storage_provider text not null default 'supabase';

alter table if exists public.bot_project_versions
  add column if not exists telegram_storage_chat_id bigint;

alter table if exists public.bot_project_versions
  add column if not exists telegram_storage_message_id bigint;

alter table if exists public.bot_project_versions
  add column if not exists telegram_storage_file_id text;

alter table if exists public.bot_project_versions
  add column if not exists backup_status text;

create index if not exists bot_project_versions_storage_provider_idx
  on public.bot_project_versions(storage_provider);

create index if not exists bot_project_versions_telegram_backup_idx
  on public.bot_project_versions(telegram_storage_chat_id, telegram_storage_message_id);
