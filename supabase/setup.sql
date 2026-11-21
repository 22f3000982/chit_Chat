-- ============================================================
-- Chit Chat — one-time database setup
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to run again (it skips things that already exist).
-- ============================================================

-- ---------- PROFILES ----------
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  name            text not null,
  last_seen       timestamptz default now(),
  hide_last_seen  boolean not null default false,
  read_receipts   boolean not null default true
);

-- Make a profile automatically whenever a user is added in Authentication.
-- The name comes from the email: sneha@chitchat.app -> "Sneha"
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, initcap(split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: users that were created before this script ran
insert into public.profiles (id, name)
select id, initcap(split_part(email, '@', 1)) from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;

drop policy if exists "profiles readable by members" on public.profiles;
create policy "profiles readable by members" on public.profiles
  for select to authenticated using (true);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------- MESSAGES ----------
create table if not exists public.messages (
  id                    uuid primary key default gen_random_uuid(),
  sender_id             uuid not null references public.profiles(id) on delete cascade,
  receiver_id           uuid not null references public.profiles(id) on delete cascade,
  content               text,
  media_path            text,          -- path inside the "media" storage bucket
  media_type            text,          -- 'image' | 'video'
  reply_to              uuid references public.messages(id) on delete set null,
  created_at            timestamptz not null default now(),
  delivered_at          timestamptz,   -- 2 grey ticks
  read_at               timestamptz,   -- 2 blue ticks
  deleted_for_everyone  boolean not null default false,
  deleted_for           uuid[] not null default '{}'   -- "delete for me"
);

create index if not exists messages_created_idx on public.messages (created_at desc);

alter table public.messages enable row level security;

drop policy if exists "read own chats" on public.messages;
create policy "read own chats" on public.messages
  for select to authenticated
  using (auth.uid() in (sender_id, receiver_id));

drop policy if exists "send as self" on public.messages;
create policy "send as self" on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid());

drop policy if exists "update own chats" on public.messages;
create policy "update own chats" on public.messages
  for update to authenticated
  using (auth.uid() in (sender_id, receiver_id))
  with check (auth.uid() in (sender_id, receiver_id));

-- Only the sender may "delete for everyone"; nobody can edit someone else's text.
create or replace function public.guard_message_update()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;  -- dashboard / service role
  if new.sender_id <> old.sender_id or new.receiver_id <> old.receiver_id
     or new.created_at <> old.created_at then
    raise exception 'not allowed';
  end if;
  if auth.uid() <> old.sender_id then
    -- receiver may only set ticks and hide for self
    if new.deleted_for_everyone <> old.deleted_for_everyone
       or new.content is distinct from old.content
       or new.media_path is distinct from old.media_path then
      raise exception 'only the sender can do that';
    end if;
  else
    -- sender may only blank the message as part of delete-for-everyone
    if (new.content is distinct from old.content or new.media_path is distinct from old.media_path)
       and not new.deleted_for_everyone then
      raise exception 'editing is not supported';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_message_update on public.messages;
create trigger guard_message_update before update on public.messages
  for each row execute function public.guard_message_update();

-- ---------- REALTIME ----------
alter table public.messages replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
end $$;

-- ---------- STORAGE (photos & videos) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800)   -- private bucket, 50 MB per file
on conflict (id) do nothing;

drop policy if exists "members read media" on storage.objects;
create policy "members read media" on storage.objects
  for select to authenticated using (bucket_id = 'media');

drop policy if exists "members upload media" on storage.objects;
create policy "members upload media" on storage.objects
  for insert to authenticated with check (bucket_id = 'media');

drop policy if exists "members delete media" on storage.objects;
create policy "members delete media" on storage.objects
  for delete to authenticated using (bucket_id = 'media');
