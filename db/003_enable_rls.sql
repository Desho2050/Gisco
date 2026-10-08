/* ============================================================
   GISCO auth migration - STEP 3: enable RLS (the real lockdown)
   ------------------------------------------------------------
   THE ORDER, start to finish
   ---------------------------
     1. db/000_preflight.sql        read-only; query 4 MUST show no
                                    broken trigger on auth.users
     2. db/001_helpers_and_roles.sql
     3. db/001b_fix_signup_trigger.sql  the trigger on auth.users
        writes to a column that no longer exists, so step 4 fails
        without it (and open signup 500s in the meantime)
     4. db/002_create_auth_users.sql
     5. re-run db/001_helpers_and_roles.sql so its admin bootstrap
        finds the account step 4 created
     6. deploy the client (gis-auth.js, auth-guard.js, index.html,
        changepass.html, warehouse.html, oracle.html) and sign in
        with a real account. Both flags at the top of gis-auth.js
        are still true, so an account without an auth row can still
        get in the old way - that is what makes this deployable
        without an outage.
     7. THIS FILE
     8. set ALLOW_LEGACY_LOGIN = false and
        ALLOW_PLAINTEXT_LOGIN_FALLBACK = false in gis-auth.js, then
        run: node tools/verify-auth-migration.js --live
        Expect every table to come back "anon blocked".
     9. db/004_retire_plaintext.sql   only after 8 is green
     Emergency exit at any point: db/ROLLBACK_disable_rls.sql

   *** DO NOT RUN THIS UNTIL STEPS 2-6 ARE DONE.
   Reason: every page in this app currently authorises itself with
   a sessionStorage boolean and talks to PostgREST as the anon
   role. The moment RLS is on with no anon policy, every one of
   those pages reads nothing and writes nothing.

   What this does
   --------------
   1. Enables RLS on every business table.
   2. Adds ONE policy per table: full CRUD for the authenticated
      role only. This is the "authenticated-only, roles later"
      choice - it removes the entire anon attack surface without
      risking a lock-out while each module is still untested.
   3. Revokes table privileges from anon, so even a missing policy
      could not leak data (defence in depth, not just RLS).
   4. Grants sequence usage to authenticated. Skipping this is the
      most common cause of "reads work but inserts fail" after
      enabling RLS.
   5. Closes user_roles to both roles; only the SECURITY DEFINER
      functions from step 1 can reach it.

   We deliberately do NOT use FORCE ROW LEVEL SECURITY. Table
   owners are exempt from RLS unless forced, and the dashboard SQL
   Editor connects as the owner - forcing it would make your own
   maintenance queries return empty and look like data loss.
   PostgREST never connects as the owner, so exemption is harmless.
   ============================================================ */

do $$
declare
  t text;
  tables text[] := array[
    'emps','employee_passports','employee_leaves','gatlocations',
    'materials','transactions','recvd_materials','oracle',
    'WO','vouchers','tasks','manpower','meter_entries','vehicles',
    'login','sim_cards','sim_transfers','company_vehicles','vehicle_transfers'
  ];
begin
  foreach t in array tables loop

    if not exists (select 1 from pg_class where oid = format('public.%I', t)::regclass) then
      raise notice 'GISCO: table % does not exist - skipped', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists gis_authenticated_full on public.%I', t);
    execute format(
      'create policy gis_authenticated_full on public.%I for all to authenticated using (true) with check (true)',
      t
    );

    -- No policy is created for anon, so anon sees nothing even if
    -- the grant below were re-added by mistake.
    execute format('revoke all on table public.%I from anon',   t);
    execute format('revoke all on table public.%I from public', t);
    execute format('grant  all on table public.%I to authenticated', t);

    raise notice 'GISCO: RLS enabled and locked for public.%', t;
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- user_roles: closed to both roles on purpose. Access is only
-- through gis_my_role(), gis_is_admin(), gis_set_role().
-- This is what prevents a signed-in user from promoting
-- themselves to admin by simply PATCHing their own role row.
--
-- A single deny-all policy is clearer than a stack of revokes:
-- using(false) rejects every read/update/delete and with
-- check(false) rejects every insert. The step 1 functions are
-- SECURITY DEFINER and run as the table owner, which is exempt
-- from RLS here (we do not FORCE it), so they keep working.
-- ------------------------------------------------------------
alter table public.user_roles enable row level security;
revoke all on table public.user_roles from anon;
revoke all on table public.user_roles from public;
grant all on table public.user_roles to authenticated;

drop policy if exists gis_deny_direct_role_access on public.user_roles;
create policy gis_deny_direct_role_access on public.user_roles
  for all to authenticated
  using (false) with check (false);


-- ------------------------------------------------------------
-- Sequences: authenticated must be able to advance them or every
-- insert into a table with a serial/identity column fails with
-- "permission denied for sequence ...".
-- ------------------------------------------------------------
grant usage, select on all sequences in schema public to authenticated;

-- ------------------------------------------------------------
-- PostgREST must still see the schema and the functions.
-- ------------------------------------------------------------
grant usage on schema public to anon, authenticated;
