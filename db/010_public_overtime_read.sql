-- ============================================================
-- GISCO migration - step 10: a narrow read door for the public page
-- ------------------------------------------------------------
-- PRECONDITION - db/003_enable_rls.sql MUST ALREADY BE APPLIED.
-- This is not a style preference, it is the difference between a
-- lockdown and an outage:
--   * Before step 3 every page - Overtime.html included - reaches
--     overtime_tasks and overtime_entries as the ANON role, because
--     it has no real session and RLS is off.
--   * This file REVOKEs everything anon currently holds on those two
--     tables and hands back only a column list and a SELECT policy.
--   * Run it before step 3 and no supervisor can save overtime at
--     all, while every other table stays exactly as wide open as it
--     is today. That is strictly worse than either state alone.
--
-- Run order: 000 -> 001 -> 001b -> 002 -> 001 again -> deploy client
--            -> 003 -> verify sign-in works -> 003b -> THIS FILE.
-- Emergency exit for both: db/ROLLBACK_disable_rls.sql
--
-- WHY COLUMN PRIVILEGES AND NOT JUST A POLICY
-- A Row Level Security policy answers "which ROWS may this role
-- see". It has no opinion about COLUMNS: a policy on a table anon
-- can select grants that role every column of the rows it allows.
-- Postgres can also grant SELECT on a named column list only, which
-- is the control we actually want here, because the sensitive thing
-- on these tables is not which rows exist - it is whose name and
-- hours appear next to which site.
--
-- So the two mechanisms do different jobs and we need both:
--   grant select (col, col, ...)  -> which columns are readable
--   create policy for select      -> which rows are readable
-- Anything not in the column list fails with 42501 "permission
-- denied for table", it does not silently come back null.
--
-- DELIBERATELY EXCLUDED
--   notes, created_by, created_at, updated_at, hours_default,
--   hours_overridden
-- None of them are displayed by Overtime-public.html. created_by is
-- a username, which is a small thing to leak and a needless one;
-- hours_overridden and notes are supervisor working data that can
-- read as an accusation about a specific person. Every one of these
-- stays visible to authenticated users, which is the whole point -
-- the public page shows less than the signed-in one by design, not
-- by accident.
--
-- WHAT THIS DOES NOT DO
-- It grants nothing to anon on emps or employee_passports. The
-- public page does not need them: db/009 snapshots employee_code and
-- both names onto overtime_entries precisely so a report never has
-- to reach into the roster. If someone later adds a query for emps
-- to the public page it will fail, and that failure is the intended
-- behaviour - do not "fix" it by widening this grant.
--
-- OPTIONAL DATE WINDOW
-- The policy below lets anon read every row. If you would rather the
-- public page only ever show the current payroll cycle, replace
-- `using (true)` in both policies with
--   using (work_date >= ((now() at time zone 'Asia/Dubai')::date - 45))
-- Both tables carry work_date (db/009 duplicated it onto the entries
-- for exactly this reason), so the two policies stay in step and a
-- cycle cannot half-appear. Note that the monthly and per-employee
-- reports in the page will then silently show partial history, so
-- pick one: full register, or window plus a notice on the page.
--
-- IDEMPOTENT: safe to run more than once.
-- ============================================================

-- ------------------------------------------------------------
-- 1. RLS on. Enabling it here makes the two overtime tables self
--    governing even if a future rollback of step 3 forgets them.
--    We do not use FORCE: the dashboard SQL editor connects as the
--    table owner, and forcing it there looks like data loss.
-- ------------------------------------------------------------
alter table public.overtime_tasks   enable row level security;
alter table public.overtime_entries enable row level security;

-- ------------------------------------------------------------
-- 2. Strip first, then hand back the narrow version.
--    The revoke is what makes this file idempotent: re-running it
--    after someone has granted broad privileges to anon restores
--    the intended shape instead of adding to it.
-- ------------------------------------------------------------
revoke all on table public.overtime_tasks   from anon;
revoke all on table public.overtime_tasks   from public;
revoke all on table public.overtime_entries from anon;
revoke all on table public.overtime_entries from public;

-- Column-level SELECT for anon. Order is the order the page prints.
grant select (id, work_date, location, task_desc, time_start, time_end)
  on public.overtime_tasks to anon;

grant select (id, task_id, work_date, employee_code, employee_name,
              employee_name_en, ot_hours)
  on public.overtime_entries to anon;

-- ------------------------------------------------------------
-- 3. One SELECT-only policy per table, anon only.
--    `for select` is the whole story: there is no insert/update/
--    delete policy for anon anywhere in this file, and without a
--    policy an insert is refused before privileges are even
--    considered. Revoking the write privileges above is the second
--    lock on the same door.
-- ------------------------------------------------------------
drop policy if exists gis_public_overtime_read on public.overtime_tasks;
create policy gis_public_overtime_read
  on public.overtime_tasks
  for select to anon
  using (true);

drop policy if exists gis_public_overtime_read on public.overtime_entries;
create policy gis_public_overtime_read
  on public.overtime_entries
  for select to anon
  using (true);

-- authenticated keeps its full access from step 3. Nothing here
-- touches it, so a signed-in supervisor still sees notes,
-- created_by and every other column, and can still write.

-- ------------------------------------------------------------
-- 4. Result, for your records.
--    Read this as "what can anon do on these two tables". Anything
--    other than SELECT on exactly the listed columns is a mistake,
--    and anything on any OTHER table is a bigger one.
-- ------------------------------------------------------------
select
  c.relname                                            as table_name,
  c.relrowsecurity                                     as rls_enabled,
  (select string_agg(distinct p.polname, ', ')
     from pg_policy p where p.polrelid = c.oid)        as policies,
  (select string_agg(p.polcmd::text || ':' || r.rolname, ', ')
     from pg_policy p
     join pg_roles r on r.oid = any (p.polroles)
    where p.polrelid = c.oid)                          as policy_role,
  pg_get_userbyid(c.relowner)                          as owner
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('overtime_tasks', 'overtime_entries')
order by c.relname;

select grantee, table_name,
       string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('overtime_tasks', 'overtime_entries')
  and grantee in ('anon', 'authenticated', 'service_role')
group by grantee, table_name
order by table_name, grantee;

-- The column list, which is the part people forget to check.
select table_name, column_name, is_grantable
from information_schema.column_privileges
where table_schema = 'public'
  and grantee = 'anon'
  and table_name in ('overtime_tasks', 'overtime_entries')
order by table_name, column_name;

-- ------------------------------------------------------------
-- 5. STILL TO DO AFTER THIS FILE - from the browser, not the SQL
--    editor. The editor connects as the owner, which is exempt from
--    RLS and holds every privilege, so a query that "works" there
--    proves nothing about anon. Prove it the way an attacker would:
--
--      a. open the site in a PRIVATE window and DO NOT sign in;
--      b. DevTools -> Network, and paste into the console:
--
--        fetch('<SUPABASE_URL>/rest/v1/overtime_entries?select=notes,created_by&limit=1',
--              { headers: { apikey: '<publishable key>',
--                           Authorization: 'Bearer <publishable key>' } })
--          .then(r => r.status).then(console.log);
--
--      c. expect 401/403 or a permission-denied body. A 200 here
--         means the column grant is wider than you think.
--
--    Then the same shape against any other table, e.g.
--    employee_passports - that must be refused as well, and is the
--    real test that step 3 landed.
-- ------------------------------------------------------------
