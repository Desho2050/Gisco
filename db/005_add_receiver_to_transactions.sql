-- ============================================================
-- GISCO migration - step 5
-- Receiver column on transactions
--
-- Warehouse stock-outs (OUT) must say who took the material.
-- The value is written by the browser as:
--     "<employee name> (<code> / <employeeid>)"
-- from the public.emps roster, so it reads well in tables,
-- prints and CSV exports without a join.
--
-- Safe to run repeatedly. Additive only: no rows are updated,
-- no defaults are set, so every existing transaction keeps
-- receiver = null and renders as '-' in the UI.
--
-- This must run BEFORE warehouse.html saves an OUT
-- transaction, otherwise the insert is rejected with
-- PGRST204 (column does not exist).
-- ============================================================

alter table public.transactions
  add column if not exists receiver text;

comment on column public.transactions.receiver is
  'Employee who received the material on an OUT transaction: "name (code / employeeid)". Null for IN and for rows recorded before this column existed.';

-- ------------------------------------------------------------
-- Result, for your records.
-- ------------------------------------------------------------
select c.column_name,
       c.data_type,
       c.is_nullable,
       c.column_default,
       (select count(*) from public.transactions t)                          as rows_total,
       (select count(*) from public.transactions t where t.receiver is not null) as rows_with_receiver
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name   = 'transactions'
   and c.column_name  = 'receiver';
