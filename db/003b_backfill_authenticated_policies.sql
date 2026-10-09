/* ============================================================
   GISCO auth migration - STEP 3b: give the signed-in role a way in
   ------------------------------------------------------------
   WHY THIS FILE EXISTS
   RLS was switched on in the live database table by table, by hand,
   over time - db/003 was never run. The result is a set of tables
   that only ever granted a policy to the ANON role:

     oracle            1 policy  anon_all_oracle        ALL to anon
     tasks             1 policy  anon_all_tasks         ALL to anon
     manpower          1 policy  anon_all_manpower      ALL to anon
     emp_details       RLS on,   0 policies             nobody

   A browser that asks as anon (no persisted session) still sees all
   70,366 oracle rows. A browser that asks as `authenticated` - which
   is every page now that the client keeps a real GoTrue session -
   matches no policy, and PostgREST answers 200 with an empty array
   and no error. That is why oracle.html shows "Total Records: 0"
   while the data is plainly still in the table.

   Verified 2026-10-08 with live reads of the same table under both
   roles; WO, tasks-like tables with `to public` policies (WO,
   vehicles, employee_leaves, employee_passports) were already fine,
   and emp_details/barcodes/meter_entries return empty for anon too,
   so those three are simply empty tables (0 rows counted as owner),
   not a permissions problem. emp_details is still included below:
   RLS on + no policy means the moment someone imports rows, every
   write from a signed-in page fails.

   What this does
   --------------
   One policy per table, identical in shape to the one db/003
   creates, so running db/003 later just replaces it:

     gis_authenticated_full  FOR ALL TO authenticated  USING (true)
                                          WITH CHECK (true)

   Deliberately ADDITIVE. Nothing is revoked here, so no page can
   lose access it currently has - the anon policies stay until the
   real lockdown (db/003 step 3, then db/004) removes them on
   purpose.

   ROLLBACK
   --------
     drop policy if exists gis_authenticated_full on public.oracle;
     drop policy if exists gis_authenticated_full on public.tasks;
     drop policy if exists gis_authenticated_full on public.manpower;
     drop policy if exists gis_authenticated_full on public.emp_details;
   ============================================================ */

do $$
declare
  t text;
  tables text[] := array['oracle', 'tasks', 'manpower', 'emp_details'];
begin
  foreach t in array tables loop

    if not exists (select 1 from pg_class where oid = format('public.%I', t)::regclass) then
      raise notice 'GISCO 003b: table % does not exist - skipped', t;
      continue;
    end if;

    execute format('drop policy if exists gis_authenticated_full on public.%I', t);
    execute format(
      'create policy gis_authenticated_full on public.%I for all to authenticated using (true) with check (true)',
      t
    );

    -- A policy alone is not enough if the role cannot touch the table
    -- at all; these grants are what PostgREST needs for writes.
    execute format('grant all on table public.%I to authenticated', t);

    raise notice 'GISCO 003b: authenticated policy added on public.%', t;
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- Post-check: every RLS-enabled table must now answer the
-- authenticated role. Anything listed here is still a page waiting
-- to show empty data.
-- ------------------------------------------------------------
select c.relname as table_name,
       (select bool_or(p.polcmd in ('r', '*')
                       and (coalesce(array_length(p.polroles, 1), 0) = 0
                            or p.polroles @> array['authenticated'::regrole]))
          from pg_policy p where p.polrelid = c.oid) as authenticated_can_read
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and c.relrowsecurity
 order by authenticated_can_read nulls first, c.relname;
