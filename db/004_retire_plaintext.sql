/* ============================================================
   GISCO auth migration - STEP 4: retire the plaintext passwords
   ------------------------------------------------------------
   *** PREREQUISITES - all four must be true before running:
     1. Step 2 ran and reported every username with a $2a$ hash.
     2. Step 3 ran; RLS is on.
     3. The deployed client signs in through Supabase Auth
        (gis-auth.js) - not the old sessionStorage boolean.
     4. You have signed in successfully with at least TWO different
        accounts, and changepass.html works for one of them.

   Why the guard below is not optional
   -----------------------------------
   Once this column is gone, the ONLY copy of a password is the
   bcrypt hash in auth.users. If any username in public.login never
   got an auth account (step 2 skipped it because its password was
   empty, or it was added afterwards), dropping the column locks
   that person out permanently with no way to recover what their
   password was. So this script counts those orphans FIRST and
   refuses to run if any exist.

   Re-running step 2 is safe (it is idempotent) - that is the fix
   the exception below asks you to do.

   What this does NOT do
   ---------------------
   It cannot un-expose what was already exposed. The plaintext
   passwords have been downloadable from a public GitHub repo and
   are present in every Supabase backup taken before today. Assume
   all of them are known and have staff change their passwords.
   ============================================================ */

-- ------------------------------------------------------------
-- Section A - reconciliation report (read-only, safe any time)
-- ------------------------------------------------------------

-- A1: usernames that exist in login but have no auth account.
select l.username,
       public.gis_email_for(l.username) as expected_email,
       case when u.id is null then 'MISSING - blocked' else 'ok' end as status
  from public.login l
  left join auth.users u
    on u.email = public.gis_email_for(l.username)
 order by status desc, l.username;

-- A2: auth accounts that exist but carry no usable hash.
select u.email,
       case
         when u.encrypted_password is null              then 'NULL hash - blocked'
         when left(u.encrypted_password, 4) not in ('$2a$','$2b$','$2y$')
                                                        then 'not bcrypt - blocked'
         else 'ok'
       end as status
  from auth.users u
 where u.aud = 'authenticated'
   and (u.encrypted_password is null
        or left(u.encrypted_password, 4) not in ('$2a$','$2b$','$2y$'));

-- A3: what public.login looks like right now, column by column.
--     Anything other than username/created-ish columns is data you
--     may want to keep - read this before section C.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'login'
 order by ordinal_position;

-- ------------------------------------------------------------
-- Section B - the fail-closed guard
-- ------------------------------------------------------------
do $$
declare
  orphan_count int;
  orphans text;
  missing_hash int;
  msg text;
begin
  select count(*) into orphan_count
    from public.login l
    left join auth.users u on u.email = public.gis_email_for(l.username)
   where u.id is null;

  select string_agg(l.username, ', ') into orphans
    from public.login l
    left join auth.users u on u.email = public.gis_email_for(l.username)
   where u.id is null;

  if orphan_count > 0 then
    -- The message is built separately and passed as an argument,
    -- because a RAISE format string interprets every % itself - and
    -- usernames here can legitimately contain one.
    msg := 'GISCO: REFUSING to drop the plaintext column. '
        || orphan_count || ' username(s) in public.login have no auth.users account: '
        || coalesce(orphans, '-')
        || '. Fix: re-run db/002_create_auth_users.sql, confirm those users can sign in, then re-run this file.';
    raise exception '%', msg;
  end if;

  select count(*) into missing_hash
    from auth.users
   where aud = 'authenticated'
     and (encrypted_password is null
          or left(encrypted_password, 4) not in ('$2a$','$2b$','$2y$'));

  if missing_hash > 0 then
    msg := 'GISCO: ' || missing_hash || ' auth account(s) have no bcrypt hash and cannot sign in through Supabase Auth. Resolve before dropping the column.';
    raise exception '%', msg;
  end if;

  raise notice 'GISCO: reconciliation clean - every login row has a hashable auth account.';
end;
$$;

-- ------------------------------------------------------------
-- Section C - drop the secret, keep the registry
-- ------------------------------------------------------------
-- public.login stays as the username registry: gis_login_usernames()
-- (step 1) reads its username column to fill the login dropdown, and
-- it is revoked from anon by step 3. Only the password column goes.
alter table public.login drop column if exists password;

-- Belt and braces: the table must never answer the anon role again,
-- even if someone later re-enables a broad policy by mistake.
revoke all on table public.login from anon;
revoke all on table public.login from public;

-- ------------------------------------------------------------
-- Section D - post-checks
-- ------------------------------------------------------------
-- D1: confirm the column really is gone. Must return 0 rows.
select column_name
  from information_schema.columns
 where table_schema = 'public' and table_name = 'login'
   and column_name = 'password';

-- D2: confirm the dropdown RPC still answers. Must return the
--     full username list, and must NOT contain a password.
select public.gis_login_usernames();

-- D3: the count that must equal your staff list.
select count(*) as login_rows,
       (select count(*) from auth.users where aud = 'authenticated') as auth_accounts
  from public.login;
