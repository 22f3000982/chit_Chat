-- ============================================================
-- Update 5: chat stats (profile) + scheduled messages
-- Paste into Supabase → SQL Editor → Run. Safe to run again.
-- (Needs updates 1–3 first; all_updates.sql covers them.)
-- ============================================================

-- Message counts shown on the friend's profile
create or replace function public.chat_stats(friend uuid)
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'total',    count(*),
    'mine',     count(*) filter (where sender_id = auth.uid()),
    'theirs',   count(*) filter (where sender_id = friend),
    'photos',   count(*) filter (where media_type = 'image'),
    'videos',   count(*) filter (where media_type = 'video'),
    'voice',    count(*) filter (where media_type = 'audio'),
    'stickers', count(*) filter (where media_type = 'sticker'),
    'first_at', min(created_at),
    'days',     count(distinct (created_at at time zone 'Asia/Kolkata')::date)
  )
  from public.messages
  where ((sender_id = auth.uid() and receiver_id = friend) or (sender_id = friend and receiver_id = auth.uid()))
    and coalesce(media_type, '') <> 'system'
    and not deleted_for_everyone
    and not (auth.uid() = any(deleted_for));
$$;
grant execute on function public.chat_stats(uuid) to authenticated;

-- Scheduled messages: kept here until it's time, then moved into messages
create table if not exists public.scheduled_messages (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  content     text not null,
  send_at     timestamptz not null,
  created_at  timestamptz not null default now()
);
alter table public.scheduled_messages enable row level security;
drop policy if exists "own scheduled" on public.scheduled_messages;
create policy "own scheduled" on public.scheduled_messages
  for all to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());

create or replace function public.send_due_scheduled()
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  secs int;
begin
  for r in delete from public.scheduled_messages where send_at <= now() returning * loop
    -- respect disappearing messages if they are on for this chat
    select coalesce((meta->>'disappear')::int, 0) into secs
    from public.messages
    where media_type = 'system'
      and ((sender_id = r.sender_id and receiver_id = r.receiver_id) or (sender_id = r.receiver_id and receiver_id = r.sender_id))
    order by created_at desc limit 1;

    insert into public.messages (id, sender_id, receiver_id, content, meta, expires_at)
    values (r.id, r.sender_id, r.receiver_id, r.content, '{"scheduled": true}'::jsonb,
            case when coalesce(secs, 0) > 0 then now() + make_interval(secs => secs) else null end)
    on conflict (id) do nothing;
  end loop;
end $$;
revoke execute on function public.send_due_scheduled() from public, anon, authenticated;

-- Check every minute for messages that are due
create extension if not exists pg_cron;
select cron.schedule('chitchat-send-scheduled', '* * * * *', $$ select public.send_due_scheduled(); $$);
