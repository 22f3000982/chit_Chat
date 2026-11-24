-- ============================================================
-- Update 7: keep message counts even after messages are deleted
-- Run ONCE before using delete_all_messages.sql. Safe to run again.
-- ============================================================

-- Saved totals of messages that were deleted
create table if not exists public.chat_stats_archive (
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  total       int not null default 0,
  photos      int not null default 0,
  videos      int not null default 0,
  voice       int not null default 0,
  stickers    int not null default 0,
  first_at    timestamptz,
  days        date[] not null default '{}',   -- days you talked (India time)
  primary key (sender_id, receiver_id)
);
alter table public.chat_stats_archive enable row level security;
drop policy if exists "read own archive" on public.chat_stats_archive;
create policy "read own archive" on public.chat_stats_archive
  for select to authenticated using (auth.uid() in (sender_id, receiver_id));

-- Profile stats = messages still in the chat + saved totals of deleted ones
create or replace function public.chat_stats(friend uuid)
returns json language sql stable security invoker set search_path = public as $$
  with live as (
    select * from public.messages
    where ((sender_id = auth.uid() and receiver_id = friend) or (sender_id = friend and receiver_id = auth.uid()))
      and coalesce(media_type, '') <> 'system'
      and not deleted_for_everyone
      and not (auth.uid() = any(deleted_for))
  ),
  arch as (
    select * from public.chat_stats_archive
    where (sender_id = auth.uid() and receiver_id = friend) or (sender_id = friend and receiver_id = auth.uid())
  ),
  talked as (
    select (created_at at time zone 'Asia/Kolkata')::date as day from live
    union
    select unnest(days) from arch
  )
  select json_build_object(
    'total',    (select count(*) from live) + (select coalesce(sum(total), 0) from arch),
    'mine',     (select count(*) from live where sender_id = auth.uid()) + (select coalesce(sum(total), 0) from arch where sender_id = auth.uid()),
    'theirs',   (select count(*) from live where sender_id = friend) + (select coalesce(sum(total), 0) from arch where sender_id = friend),
    'photos',   (select count(*) from live where media_type = 'image') + (select coalesce(sum(photos), 0) from arch),
    'videos',   (select count(*) from live where media_type = 'video') + (select coalesce(sum(videos), 0) from arch),
    'voice',    (select count(*) from live where media_type = 'audio') + (select coalesce(sum(voice), 0) from arch),
    'stickers', (select count(*) from live where media_type = 'sticker') + (select coalesce(sum(stickers), 0) from arch),
    'first_at', least((select min(created_at) from live), (select min(first_at) from arch)),
    'days',     (select count(*) from talked)
  );
$$;
grant execute on function public.chat_stats(uuid) to authenticated;
