-- ============================================================
-- Update 1: chat list features (pin, archive, lock, hide, unread)
-- Paste into Supabase → SQL Editor → Run. Safe to run again.
-- ============================================================

-- Per-person settings for each chat. Only you can see your own.
create table if not exists public.chat_prefs (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  friend_id    uuid not null references public.profiles(id) on delete cascade,
  pinned       boolean not null default false,
  archived     boolean not null default false,
  locked       boolean not null default false,
  hidden       boolean not null default false,
  last_read_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);
alter table public.chat_prefs enable row level security;
drop policy if exists "own chat prefs" on public.chat_prefs;
create policy "own chat prefs" on public.chat_prefs
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Secret code for locked / hidden chats (stored hashed). Only you can see your own.
create table if not exists public.private_settings (
  user_id   uuid primary key references public.profiles(id) on delete cascade,
  lock_hash text
);
alter table public.private_settings enable row level security;
drop policy if exists "own private settings" on public.private_settings;
create policy "own private settings" on public.private_settings
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
