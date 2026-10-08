-- GISCO: repair the pre-existing signup trigger. It wrote to
-- user_roles.can_delete_transactions, a column that does not exist, so every
-- insert into auth.users failed (that is the project's "Database error saving
-- new user" on open signup). Same behaviour otherwise: default worker role.
create or replace function public.create_user_role_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_roles (user_id, role)
        values (new.id, 'worker')
  on conflict (user_id) do nothing;
  return new;
end;
$$;