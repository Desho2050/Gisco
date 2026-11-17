-- ============================================================
-- 014: keep oracle.updated_at honest
-- ------------------------------------------------------------
-- WHY
-- oracle.html now syncs smartly: instead of re-downloading all
-- ~72k rows on every visit it asks the server for a tiny
-- fingerprint (row count + newest updated_at) and compares it
-- with the local IndexedDB cache. That only works if an UPDATE
-- moves updated_at. The oracle table predates these migrations
-- and never got the trigger, so pure edits (count unchanged)
-- were invisible to every other device's cache check.
--
-- Safe to re-run: create or replace + drop-if-exists.
-- ============================================================

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists oracle_set_updated_at on public.oracle;
create trigger oracle_set_updated_at
  before update on public.oracle
  for each row execute function public.update_updated_at_column();
