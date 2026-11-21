-- ============================================================
-- Update 2: reactions + edit message
-- Paste into Supabase → SQL Editor → Run. Safe to run again.
-- ============================================================

alter table public.messages add column if not exists reactions jsonb not null default '{}';  -- { "<user id>": "❤️" }
alter table public.messages add column if not exists edited_at timestamptz;

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

  -- you can only add / change / remove your own reaction
  if (coalesce(new.reactions, '{}'::jsonb) - me::text) <> (coalesce(old.reactions, '{}'::jsonb) - me::text) then
    raise exception 'you can only change your own reaction';
  end if;

  if me <> old.sender_id then
    -- receiver: ticks, reactions and "delete for me" only
    if new.deleted_for_everyone <> old.deleted_for_everyone
       or new.content is distinct from old.content
       or new.media_path is distinct from old.media_path
       or new.edited_at is distinct from old.edited_at then
      raise exception 'only the sender can do that';
    end if;
    return new;
  end if;

  -- sender
  if new.deleted_for_everyone then return new; end if;   -- delete for everyone blanks the message
  if new.media_path is distinct from old.media_path or new.media_type is distinct from old.media_type then
    raise exception 'not allowed';
  end if;
  if new.content is distinct from old.content then
    if old.deleted_for_everyone then raise exception 'message was deleted'; end if;
    if now() - old.created_at > interval '15 minutes' then raise exception 'messages can only be edited for 15 minutes'; end if;
    new.edited_at := now();
  end if;
  return new;
end $$;

-- Add / change / remove my reaction without overwriting the other person's
create or replace function public.react(msg_id uuid, emoji text)
returns void language sql security invoker set search_path = public as $$
  update public.messages
  set reactions = case
    when emoji is null or emoji = '' then reactions - auth.uid()::text
    else reactions || jsonb_build_object(auth.uid()::text, emoji)
  end
  where id = msg_id;
$$;
grant execute on function public.react(uuid, text) to authenticated;
