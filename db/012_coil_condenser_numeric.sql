-- ============================================================
-- GISCO migration - step 12
-- Coil Condenser on WO accepts decimal quantities
--
-- 011 created coil_condenser as integer, so saving a work order
-- with e.g. 69897.6 failed with 22P02 (invalid input syntax for
-- type integer). numeric keeps the decimals exactly as entered.
--
-- Safe to run repeatedly. Existing values are unchanged.
-- ============================================================

alter table public."WO"
  alter column coil_condenser type numeric;

comment on column public."WO".coil_condenser is
  'Quantity of coil condenser units on the work order; decimals allowed. Null for rows recorded before this column existed.';

-- ------------------------------------------------------------
-- Result, for your records.
-- ------------------------------------------------------------
select c.column_name,
       c.data_type,
       c.is_nullable
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name   = 'WO'
   and c.column_name  = 'coil_condenser';
