-- ============================================================
-- Update 6: profile photo
-- Paste into Supabase → SQL Editor → Run. Safe to run again.
-- ============================================================
alter table public.profiles add column if not exists avatar_path text;  -- file inside the "media" bucket
