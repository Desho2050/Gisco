-- ============================================================
-- GISCO migration - step 11
-- Coil Condenser column on WO
--
-- WO.html gained a "Coil Condenser" column after "Air Curtain".
-- The add/edit forms write coil_condenser, so until this runs
-- every insert and update from that page fails with PGRST204
-- (column does not exist).
--
-- Safe to run repeatedly. Additive only: no rows are updated,
-- no defaults are set, so every existing work order keeps
-- coil_condenser = null and renders as blank in the UI.
-- ============================================================

alter table public."WO"
  add column if not exists coil_condenser integer;

comment on column public."WO".coil_condenser is
  'Number of coil condenser units on the work order. Null for rows recorded before this column existed.';

-- ------------------------------------------------------------
-- Result, for your records.
-- ------------------------------------------------------------
select c.column_name,
       c.data_type,
       c.is_nullable,
       c.column_default,
       (select count(*) from public."WO" t)                             as rows_total,
       (select count(*) from public."WO" t where t.coil_condenser is not null) as rows_with_coil_condenser
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name   = 'WO'
   and c.column_name  = 'coil_condenser';
