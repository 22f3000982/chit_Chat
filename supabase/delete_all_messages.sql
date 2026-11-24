-- ============================================================
-- DELETE ALL MESSAGES (cannot be undone)
-- Message counts on the profile are kept: they are added to
-- chat_stats_archive first. Needs update_7_keep_counts.sql.
-- Photos/videos/voice files must be removed separately in
-- Supabase → Storage → media (keep the avatar-… files).
-- ============================================================
begin;

-- 1) save the counts
insert into public.chat_stats_archive as a
  (sender_id, receiver_id, total, photos, videos, voice, stickers, first_at, days)
select
  sender_id, receiver_id,
  count(*),
  count(*) filter (where media_type = 'image'),
  count(*) filter (where media_type = 'video'),
  count(*) filter (where media_type = 'audio'),
  count(*) filter (where media_type = 'sticker'),
  min(created_at),
  array_agg(distinct (created_at at time zone 'Asia/Kolkata')::date)
from public.messages
where coalesce(media_type, '') <> 'system' and not deleted_for_everyone
group by sender_id, receiver_id
on conflict (sender_id, receiver_id) do update set
  total    = a.total + excluded.total,
  photos   = a.photos + excluded.photos,
  videos   = a.videos + excluded.videos,
  voice    = a.voice + excluded.voice,
  stickers = a.stickers + excluded.stickers,
  first_at = least(a.first_at, excluded.first_at),
  days     = array(select distinct d from unnest(a.days || excluded.days) as d order by d);

-- 2) delete every message (stars on them go too)
delete from public.messages;

commit;

-- check: should show 0 messages and the saved totals
select (select count(*) from public.messages) as messages_left,
       p1.name as sender, p2.name as receiver, a.total
from public.chat_stats_archive a
join public.profiles p1 on p1.id = a.sender_id
join public.profiles p2 on p2.id = a.receiver_id;
