-- ============================================================
-- Update 4: phone notifications
-- Paste into Supabase → SQL Editor → Run. Safe to run again.
-- Replace CHANGE_ME_SECRET with the same secret used in the "notify" Edge Function.
-- ============================================================

create extension if not exists pg_net with schema extensions;

-- Devices that want notifications
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Every new message → call the "notify" Edge Function, which sends the push
create or replace function public.notify_new_message()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url     := 'https://ooncpqvqiobxxmbxpdxc.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-chitchat-secret', 'CHANGE_ME_SECRET'),
    body    := jsonb_build_object('record', to_jsonb(new))
  );
  return new;
exception when others then
  return new;  -- never block sending a message because of notifications
end $$;

drop trigger if exists on_message_notify on public.messages;
create trigger on_message_notify
  after insert on public.messages
  for each row execute function public.notify_new_message();
