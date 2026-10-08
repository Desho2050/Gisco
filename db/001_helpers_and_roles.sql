/* ============================================================
   GISCO auth migration - STEP 1: helpers and role access
   ------------------------------------------------------------
   Safe to run now. It changes no data the app reads and breaks
   nothing, because the app never calls these functions yet.
   Run 000_preflight.sql first and confirm query 4 shows no
   broken trigger on auth.users; fix that before step 2.

   Design notes
   ------------
   * Hosted Supabase has no username sign-in. GoTrue answers a
     username payload with "missing email or phone". We therefore
     derive a stable, unreachable synthetic email from the
     username. The domain lives in ONE function so it can be
     changed in a single statement later.
   * user_roles becomes reachable only through SECURITY DEFINER
     functions. If policies on user_roles were allowed to call a
     function that reads user_roles, RLS would recurse into itself
     and every query would hang or error. Keeping the table closed
     to anon/authenticated and routing through definer functions
     avoids that class of bug and stops any signed-in user from
     granting themselves admin.
   * search_path is pinned on every definer function. Without it a
     malicious table in another schema on the session search_path
     could be resolved instead - the standard privilege-escalation
     footgun for SECURITY DEFINER.
   ============================================================ */

-- ------------------------------------------------------------
-- The synthetic email domain. Change here, nowhere else.
-- RFC-2606 style reserved TLD: nothing can ever be delivered to
-- it, so a forgotten password cannot be "reset" by mail either.
-- If you later want real email recovery, swap this for a subdomain
-- of a domain you control and re-run step 2.
-- ------------------------------------------------------------
create or replace function public.gis_auth_domain()
returns text
language sql
immutable
as $$
  select 'gisco.internal';
$$;

-- username -> email. Lower-cased and trimmed so the login
-- dropdown value always maps to the same account.
create or replace function public.gis_email_for(p_username text)
returns text
language sql
immutable
as $$
  select lower(btrim(p_username)) || '@' || public.gis_auth_domain();
$$;

-- The browser asks for the domain at sign-in time instead of
-- hardcoding it, so the two sides can never drift apart. These two
-- are the only step-1 functions the client calls directly, and both
-- return nothing sensitive.
grant execute on function public.gis_auth_domain() to anon, authenticated;
grant execute on function public.gis_email_for(text) to anon, authenticated;

-- Current signed-in user id, or NULL for anon.
create or replace function public.gis_uid()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

-- ------------------------------------------------------------
-- The username list for the login screen.
-- SECURITY DEFINER is what makes this possible after step 3: the
-- login table is revoked from anon, but this function still reads
-- it as its owner and hands back ONLY usernames. No password can
-- cross this boundary because the return type is text.
-- ------------------------------------------------------------
create or replace function public.gis_login_usernames()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
           array_agg(username order by username),
           '{}'::text[]
         )
    from public.login;
$$;

revoke all on function public.gis_login_usernames() from public;
grant execute on function public.gis_login_usernames() to anon, authenticated;

-- ------------------------------------------------------------
-- Role lookup for the signed-in user. Returns the caller's own
-- row and nothing else; a user cannot read someone else's role.
-- ------------------------------------------------------------
create or replace function public.gis_my_role()
returns public.user_roles
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r public.user_roles;
  uid uuid = auth.uid();
begin
  if uid is null then
    return null;
  end if;

  select * into r
    from public.user_roles
   where user_id = uid;

  return r;
end;
$$;

revoke all on function public.gis_my_role() from public;
grant execute on function public.gis_my_role() to authenticated;

-- ------------------------------------------------------------
-- Is the caller an admin? Used by gis_set_role below and by any
-- future per-module policy. Definer + closed table = no recursion.
-- ------------------------------------------------------------
create or replace function public.gis_is_admin(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.user_roles
     where user_id = p_uid
       and lower(role) = 'admin'
  );
$$;

revoke all on function public.gis_is_admin(uuid) from public;
-- anon must be able to call it (it will simply get false); admin
-- checks must not depend on being signed in.
grant execute on function public.gis_is_admin(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- The only way to change roles. Refuses unless the caller is an
-- admin, so a signed-in store keeper cannot escalate themselves.
-- ------------------------------------------------------------
create or replace function public.gis_set_role(
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.gis_is_admin(auth.uid()) then
    raise exception 'GISCO: only an admin may change roles'
      using errcode = '42501';
  end if;

  if p_role is null or btrim(p_role) = '' then
    raise exception 'GISCO: role must not be empty';
  end if;

  insert into public.user_roles (user_id, role)
        values (p_user_id, p_role)
   on conflict (user_id)
   do update set role = excluded.role,
                 updated_at = now();
end;
$$;

revoke all on function public.gis_set_role(uuid, text) from public;
grant execute on function public.gis_set_role(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- There must be a unique key on user_roles.user_id before any
-- ON CONFLICT clause can work, so add it first.
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.user_roles'::regclass
       and contype in ('u','p')
  ) then
    alter table public.user_roles add constraint user_roles_user_id_key unique (user_id);
    raise notice 'GISCO: added unique constraint on user_roles.user_id';
  else
    raise notice 'GISCO: user_roles.user_id is already unique - nothing to add';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- Bootstrap: make sure at least one admin exists, or role editing
-- becomes permanently unreachable once step 3 closes the table.
-- Requires step 2 to have created the auth user; re-run this
-- section after step 2 if it reports the notice below.
-- ------------------------------------------------------------
do $$
declare
  uid uuid;
  admins int;
begin
  select id into uid from auth.users
   where email = public.gis_email_for('Desho');

  if uid is null then
    raise notice 'GISCO: no auth user for Desho yet - run step 2, then re-run this block.';
    return;
  end if;

  insert into public.user_roles (user_id, role,
                                 can_stock_in, can_stock_out,
                                 can_delete_in_transactions, can_delete_out_transactions,
                                 can_add_material, can_edit_material, can_delete_material)
       values (uid, 'admin', true, true, true, true, true, true, true)
  on conflict (user_id) do update
    set role = 'admin',
        can_stock_in = true, can_stock_out = true,
        can_delete_in_transactions = true, can_delete_out_transactions = true,
        can_add_material = true, can_edit_material = true, can_delete_material = true,
        updated_at = now();

  select count(*) into admins from public.user_roles where lower(role) = 'admin';
  raise notice 'GISCO: admin accounts now = %', admins;
end;
$$;
