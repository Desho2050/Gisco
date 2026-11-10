-- ============================================================
-- GISCO migration - step 13
-- WO amount accepts decimal currency
--
-- Saving a work order with e.g. 69897.6 in WORK ORDER AMOUNT
-- failed with 22P02 because amount was integer. Money needs the
-- decimals; numeric keeps them exactly as entered.
--
-- Also documents 012: coil_condenser integer -> numeric, which
-- was run first after the same error appeared on that column.
--
-- Safe to run repeatedly. Existing values are unchanged.
-- ============================================================

alter table public."WO"
  alter column amount type numeric;

comment on column public."WO".amount is
  'Work order value in AED; decimals allowed.';

-- ------------------------------------------------------------
-- Result, for your records.
-- ------------------------------------------------------------
select c.column_name,
       c.data_type
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name   = 'WO'
   and c.column_name in ('amount', 'coil_condenser')
 order by c.column_name;
