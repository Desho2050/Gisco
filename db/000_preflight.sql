/* ============================================================
   GISCO auth migration - STEP 0: pre-flight (READ ONLY)
   ------------------------------------------------------------
   Run this in Supabase Dashboard -> SQL Editor BEFORE any other
   file in this folder. It changes nothing. It answers four
   questions that determine whether the rest of the migration can
   succeed, and prints a result set for each.

   Why it matters specifically here:
     * Open signup on this project returns HTTP 500
       "Database error saving new user". That means something in
       the database rejects inserts into auth.users - most likely
       a trigger whose function is broken or references a table
       that no longer exists. Query 4 finds it. If we create users
       while that trigger is broken, step 2 fails the same way.
   ============================================================ */

-- 1. Which tables are protected today, and which are wide open?
--    Expect relrowsecurity = false everywhere. Any table showing
--    true but with no policies would return 0 rows to the app,
--    which is how people "lose" data without deleting it.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policy_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
 order by c.relname;

-- 2. Exactly who can do what on each table right now?
--    'anon' holding SELECT/INSERT/UPDATE/DELETE is the finding:
--    RLS off + grants = anyone on the internet.
select grantee,
       table_name,
       string_agg(privilege_type, ',' order by privilege_type) as privileges
  from information_schema.role_table_grants
 where table_schema = 'public'
   and grantee in ('anon','authenticated','service_role','public')
 group by grantee, table_name
 order by table_name, grantee;

-- 3. Does PostgREST still have what it needs to switch roles?
--    If these come back false, nothing works after the migration
--    and it is NOT RLS that is to blame.
select has_schema_privilege('anon','public','USAGE')        as anon_schema_usage,
       has_schema_privilege('authenticated','public','USAGE') as auth_schema_usage,
       has_database_privilege('authenticated','postgres','CONNECT') as auth_can_connect;

-- 4. THE BLOCKER CHECK - what fires on an insert into auth.users?
--    Read the function bodies printed here. A trigger that inserts
--    into a missing table (commonly public.profiles) is the usual
--    cause of "Database error saving new user".
select t.tgname as trigger_name,
       p.proname as function_name,
       case when p.proname is null
            then 'DANGLING - trigger points at a missing function (this breaks inserts)'
            else 'ok' end as function_status,
       pg_get_functiondef(p.oid) as definition
  from pg_trigger t
  left join pg_proc p on p.oid = t.tgfoid
 where t.tgrelid = 'auth.users'::regclass
   and not t.tgisinternal
 order by t.tgname;

-- 5. Which tables have bigserial-style ids? After RLS goes on,
--    authenticated inserts fail with "permission denied for sequence"
--    unless step 3 grants sequence usage. This tells us if that
--    grant is actually needed.
select c.relname as table_name, s.relname as sequence_name
  from pg_class s
  join pg_namespace n on n.oid = s.relnamespace
  join pg_depend d on d.objid = s.oid and d.deptype = 'a'
  join pg_class c on c.oid = d.refobjid
 where n.nspname = 'public' and s.relkind = 'S'
 order by c.relname;

-- 6. Current account list to migrate. Note: this table holds
--    plaintext passwords and is readable by anon today. It is
--    retired by step 4 of the migration.
select username,
       length(password) as password_length,
       length(password) < 6 as below_gotrue_minimum,
       length(password) > 72 as too_long_for_bcrypt
  from public.login
 order by username;

-- 7. Who already exists in auth.users? user_roles contains real
--    UUIDs, so somebody created auth users before. We must not
--    collide with them in step 2.
select u.id, u.email, u.role,
       u.email_confirmed_at is not null as confirmed,
       u.last_sign_in_at,
       u.raw_user_meta_data->>'username' as meta_username
  from auth.users u
 order by u.created_at;

-- 8. Existing role rows - the admin bootstrap in step 1 must not
--    duplicate these.
select user_id, role, can_stock_in, can_stock_out,
       can_add_material, can_edit_material, can_delete_material
  from public.user_roles
 order by role;
