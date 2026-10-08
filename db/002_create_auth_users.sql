/* ============================================================
   GISCO auth migration - STEP 2: create real auth accounts
   ------------------------------------------------------------
   Prerequisites: 000_preflight.sql run, its query 4 shows no
   broken trigger on auth.users, 001 has been run, AND
   db/001b_fix_signup_trigger.sql has been run. On this project the
   on_auth_user_created trigger inserts into a user_roles column
   that does not exist, so without 001b this step fails with
   "column \"can_delete_transactions\" of relation \"user_roles\"
   does not exist" and rolls back cleanly.

   What this does
   --------------
   For every row in public.login it creates a Supabase Auth user
   whose email is the derived synthetic address, and stores the
   existing password as a bcrypt hash via crypt()/gen_salt('bf').
   The plaintext is never written anywhere new - it is consumed by
   pgcrypto and only the hash is persisted. After this, signing in
   with the same password works, but no browser can read it.

   Run it more than once safely: accounts that already exist keep
   their email, id and password hash (the repair pass below only
   fills columns that are still NULL), and new rows are added for
   any login entry that does not have an account yet. Adding a
   person later is: insert their row in public.login with a
   password, re-run this file, then re-run the bootstrap block at
   the end of db/001_helpers_and_roles.sql if they are meant to be
   an admin.

   Dated observation (audit, 2026-10-08): public.login held exactly
   one row, username Desho, whose password was 6 characters - the
   same length GoTrue now enforces as its minimum. So expect ONE
   account created here, not a list.

   IF THIS FAILS with "Database error saving new user" or a
   trigger error, that is the pre-existing broken trigger the
   pre-flight found. Fix or drop that trigger first - do not work
   around it by inserting with the trigger disabled, because the
   same trigger will fire again for every future user you create.
   ============================================================ */

do $$
declare
  r             record;
  v_email       text;
  v_uid         uuid;
  v_instance_id uuid;
  created       int := 0;
  skipped       int := 0;
begin
  -- Prefer the instance_id that accounts GoTrue created itself are
  -- already using; on a project with no such account fall back to
  -- GoTrue's default instance. Never leave it NULL.
  select instance_id into v_instance_id
    from auth.users
   where instance_id is not null
   order by created_at
   limit 1;

  if v_instance_id is null then
    v_instance_id := '00000000-0000-0000-0000-000000000000'::uuid;
  end if;

  for r in select id, username, password from public.login order by username
  loop
    v_email := public.gis_email_for(r.username);

    if r.password is null or btrim(r.password) = '' then
      raise notice 'GISCO: % has no password to carry over - skipping; set one in the dashboard', r.username;
      skipped := skipped + 1;
      continue;
    end if;

    -- bcrypt (pgcrypto 'bf') only reads the first 72 bytes.
    if length(r.password) > 72 then
      raise exception 'GISCO: password for % is longer than the 72-byte bcrypt limit', r.username;
    end if;

    select id into v_uid from auth.users where email = v_email;

    if v_uid is not null then
      raise notice 'GISCO: account for % already exists (%) - left untouched', r.username, v_uid;
      skipped := skipped + 1;
      continue;
    end if;

    -- instance_id and the four token columns are NOT optional
    -- decoration: GoTrue filters every login lookup by instance_id,
    -- and it scans confirmation_token / recovery_token /
    -- email_change / email_change_token_new into non-nullable Go
    -- strings. A bare INSERT leaves them NULL, and the account then
    -- fails to sign in - GoTrue reports "Invalid login credentials"
    -- (NULL instance_id hides the row from the lookup) and, once
    -- instance_id is set, a 500 "Database error querying schema"
    -- after the password check. Verified live on this project on
    -- 2026-10-08. Write them the way GoTrue writes its own accounts.
    insert into auth.users (
      id, instance_id,
      aud, role, email, encrypted_password,
      email_confirmed_at,
      confirmation_token, recovery_token,
      email_change, email_change_token_new,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      gen_random_uuid(),
      v_instance_id,
      'authenticated',
      'authenticated',
      v_email,
      crypt(r.password, gen_salt('bf')),
      now(),                                   -- confirmed: no mail can ever reach .internal
      '', '', '', '',                          -- GoTrue stores empty, not NULL
      jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
      jsonb_build_object('username', r.username),
      now(), now()
    )
    returning id into v_uid;

    -- GoTrue expects an identity row for email providers. Without
    -- it, some client operations (linked-identity lookups, later
    -- password changes) behave inconsistently.
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(),
      v_uid,
      v_uid,
      jsonb_build_object(
        'sub', v_uid::text,
        'email', v_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(), now(), now()
    )
    on conflict (provider_id, provider) do nothing;

    raise notice 'GISCO: created auth account for % (id %)', r.username, v_uid;
    created := created + 1;
  end loop;

  raise notice 'GISCO: step 2 finished - % created, % already existed', created, skipped;
end;
$$;

-- ------------------------------------------------------------
-- Repair pass, idempotent. Accounts written by an older copy of
-- this file (or created by hand) can carry NULL for instance_id and
-- for the token columns, and GoTrue cannot read such a row: the
-- symptom is a warehouse sign-in that answers "Invalid login
-- credentials" to the correct password, or a 500 after the password
-- check. Only synthetic-domain accounts are touched, and only where
-- the column is still NULL.
-- ------------------------------------------------------------
do $$
declare
  v_instance_id uuid;
begin
  select instance_id into v_instance_id
    from auth.users
   where instance_id is not null
   order by created_at
   limit 1;

  if v_instance_id is not null then
    update auth.users
       set instance_id = v_instance_id
     where email like '%@' || public.gis_auth_domain()
       and instance_id is null;
  end if;

  update auth.users
         set confirmation_token     = coalesce(confirmation_token, ''),
             recovery_token         = coalesce(recovery_token, ''),
             email_change           = coalesce(email_change, ''),
             email_change_token_new = coalesce(email_change_token_new, '')
     where email like '%@' || public.gis_auth_domain();
end;
$$;

-- ------------------------------------------------------------
-- Result, for your records. Prints identities only - never hashes
-- and never the plaintext. has_instance and token_shape_ok must
-- both be true or GoTrue will not be able to sign that account in.
-- ------------------------------------------------------------
select u.email,
       u.raw_user_meta_data->>'username' as username,
       u.email_confirmed_at is not null  as confirmed,
       u.instance_id is not null         as has_instance,
       (u.confirmation_token is not null
        and u.recovery_token is not null
        and u.email_change is not null
        and u.email_change_token_new is not null) as token_shape_ok,
       left(u.encrypted_password, 7)     as hash_prefix,  -- $2a$.. proves bcrypt
       (select count(*) from auth.identities i where i.user_id = u.id) as identity_rows
  from auth.users u
 where u.email like '%@' || public.gis_auth_domain()
 order by u.email;

-- ------------------------------------------------------------
-- NOW VERIFY BEFORE CONTINUING to step 3.
-- In the dashboard: Authentication -> Users, confirm the account
-- exists. Then sign in from the app with the SAME username and
-- password as before. If that works, the hash carried over
-- correctly and you may proceed to enable RLS.
-- ------------------------------------------------------------
