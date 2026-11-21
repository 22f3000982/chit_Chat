-- ============================================================
-- Update 3: voice notes, stickers, view once, pin message,
--           star message, disappearing messages
-- Paste into Supabase → SQL Editor → Run. Safe to run again.
-- (Needs update_2_react_edit.sql to have been run first.)
-- ============================================================

alter table public.messages add column if not exists meta       jsonb not null default '{}'; -- voice duration, sticker id, system info
alter table public.messages add column if not exists view_once  boolean not null default false;
alter table public.messages add column if not exists viewed_at  timestamptz;
alter table public.messages add column if not exists pinned_at  timestamptz;
alter table public.messages add column if not exists expires_at timestamptz;              -- disappearing messages

create index if not exists messages_expires_idx on public.messages (expires_at) where expires_at is not null;

-- Expired (disappeared) messages are invisible to everyone
drop policy if exists "read own chats" on public.messages;
create policy "read own chats" on public.messages
  for select to authenticated
  using (auth.uid() in (sender_id, receiver_id) and (expires_at is null or expires_at > now()));

-- Delete expired messages; returns their file paths so the app can remove the files too
create or replace function public.cleanup_expired()
returns setof text language plpgsql security definer set search_path = public as $$
begin
  return query
    delete from public.messages
    where expires_at < now() and auth.uid() in (sender_id, receiver_id)
    returning media_path;
end $$;
grant execute on function public.cleanup_expired() to authenticated;

-- Starred messages (private to each person)
create table if not exists public.starred (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
alter table public.starred enable row level security;
drop policy if exists "own stars" on public.starred;
create policy "own stars" on public.starred
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Who may change what when a message is updated
create or replace function public.guard_message_update()
returns trigger language plpgsql as $$
declare me uuid := auth.uid();
begin
  if me is null then return new; end if;  -- dashboard / service role
  if new.id <> old.id or new.sender_id <> old.sender_id or new.receiver_id <> old.receiver_id
     or new.created_at <> old.created_at then
    raise exception 'not allowed';
  end if;

  -- reactions: only your own
  if (coalesce(new.reactions, '{}'::jsonb) - me::text) <> (coalesce(old.reactions, '{}'::jsonb) - me::text) then
    raise exception 'you can only change your own reaction';
  end if;

  -- these never change after sending
  if new.view_once <> old.view_once or new.expires_at is distinct from old.expires_at
     or new.meta is distinct from old.meta then
    raise exception 'not allowed';
  end if;

  if me <> old.sender_id then
    -- receiver: ticks, reactions, pin, "delete for me", and opening a view-once
    if new.viewed_at is distinct from old.viewed_at then
      if not old.view_once or old.viewed_at is not null then raise exception 'not allowed'; end if;
      new.viewed_at := now();
    end if;
    if new.media_path is distinct from old.media_path
       and not (old.view_once and new.media_path is null and new.viewed_at is not null) then
      raise exception 'not allowed';
    end if;
    if new.deleted_for_everyone <> old.deleted_for_everyone
       or new.content is distinct from old.content
       or new.media_type is distinct from old.media_type
       or new.edited_at is distinct from old.edited_at then
      raise exception 'only the sender can do that';
    end if;
    return new;
  end if;

  -- sender
  if new.deleted_for_everyone then return new; end if;   -- delete for everyone blanks the message
  if new.viewed_at is distinct from old.viewed_at
     or new.media_path is distinct from old.media_path
     or new.media_type is distinct from old.media_type then
    raise exception 'not allowed';
  end if;
  if new.content is distinct from old.content then
    if old.deleted_for_everyone then raise exception 'message was deleted'; end if;
    if now() - old.created_at > interval '15 minutes' then raise exception 'messages can only be edited for 15 minutes'; end if;
    new.edited_at := now();
  end if;
  return new;
end $$;
