-- ============================================================
-- Create (or reset) the two logins. Run AFTER setup.sql.
-- Replace the two passwords below before running.
-- Running it again just updates the passwords.
-- (Don't commit real passwords to GitHub.)
-- ============================================================
do $$
declare
  u record;
  uid uuid;
begin
  for u in
    select * from (values
      ('sneha@chitchat.app', 'CHANGE_ME_SNEHA'),
      ('axon@chitchat.app',  'CHANGE_ME_AXON')
    ) as t(email, pass)
  loop
    select id into uid from auth.users where email = u.email;

    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new
      ) values (
        '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
        u.email, extensions.crypt(u.pass, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now(),
        '', '', '', ''
      );
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (
        gen_random_uuid(), uid, uid::text,
        jsonb_build_object('sub', uid::text, 'email', u.email, 'email_verified', true),
        'email', now(), now(), now()
      );
    else
      update auth.users
      set encrypted_password = extensions.crypt(u.pass, extensions.gen_salt('bf')), updated_at = now()
      where id = uid;
    end if;
  end loop;
end $$;

-- make sure both have a chat profile
insert into public.profiles (id, name)
select id, initcap(split_part(email, '@', 1)) from auth.users
on conflict (id) do nothing;

select p.name, u.email from public.profiles p join auth.users u on u.id = p.id;
