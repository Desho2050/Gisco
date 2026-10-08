/* ============================================================
   GISCO auth migration - EMERGENCY ROLLBACK
   ------------------------------------------------------------
   Use this ONLY if step 3 has been run and the app is broken
   (pages load but show no data, or every save fails).
   It puts the database back into the pre-step-3 state: RLS off,
   anon can read and write again, so the OLD client keeps working.

   Deliberately NOT rolled back
   ----------------------------
   * auth.users accounts from step 2 stay. They are additive,
     nothing reads them unless a client calls supabase.auth, and
     deleting them would destroy the bcrypt password copies.
   * The step 1 helper functions stay. They are not referenced by
     the old client and removing them only creates more risk.
   * If 004_retire_plaintext.sql has already run, public.login has
     no password column and this script cannot bring it back - the
     plaintext copies exist only in your Supabase backups. In that
     case the deployed client MUST keep using Supabase Auth; roll
     the client back only to a build that signs in, not to the old
     sessionStorage one.

   After running this: tell me which page failed and what the
   console said, and re-run 000_preflight.sql to confirm the state.
   ============================================================ */

do $$
declare
  t text;
  tables text[] := array[
    'emps','employee_passports','employee_leaves','gatlocations',
    'materials','transactions','recvd_materials','oracle',
    'WO','vouchers','tasks','manpower','meter_entries','vehicles',
    'login','user_roles'
  ];
begin
  foreach t in array tables loop

    if not exists (select 1 from pg_class where oid = format('public.%I', t)::regclass) then
      continue;
    end if;

    -- Remove every GISCO policy on the table, whatever its name.
    execute format(
      'drop policy if exists gis_authenticated_full on public.%I', t);
    execute format(
      'drop policy if exists gis_deny_direct_role_access on public.%I', t);

    execute format('alter table public.%I disable row level security', t);

    -- Restore the original shape: anon and public have full DML.
    execute format('grant all on table public.%I to anon', t);
    execute format('grant all on table public.%I to public', t);

    raise notice 'GISCO ROLLBACK: public.% is open to anon again', t;
  end loop;
end;
$$;

-- Any policy someone added outside these two names would survive
-- the loop above with RLS now off (so it is inert) - list them so
-- you can decide, rather than leaving them hidden.
select t.tablename, p.policyname, p.cmd
  from pg_policies p
  join pg_tables t on t.tablename = p.tablename
 where p.schemaname = 'public'
 order by t.tablename, p.policyname;

-- Sequences back to the pre-migration grant set.
grant usage, select on all sequences in schema public to anon;
grant usage on schema public to anon, authenticated;

-- Final state check: every public table must show rls_enabled = false.
select relname as table_name,
       relrowsecurity as rls_enabled,
       relforcerowsecurity as rls_forced
  from pg_class
 where relnamespace = 'public'::regnamespace
   and relkind = 'r'
 order by relname;
