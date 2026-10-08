-- ============================================================
-- GISCO migration - step 6
-- Location column on transactions
--
-- An OUT transaction must also say where the material was used.
-- The browser writes one of the eight fixed sites, or any
-- free-text value the operator typed into the Location box:
--     AL HAIL 43, AL HAIL 73, SEIH ALBANAH, SEIH ALBANAH MUSANADA,
--     SEIH ALBANAH KATEBA, FUJAIRAH AIRPORT, FUJAIRAH NAVY BASE,
--     AL JAZEERA AL HAMRAH
--
-- The two spellings the operator dictated ("FUJIARAH ARIPORT",
-- "FUJAIRAH NAVEY BASE") were corrected to FUJAIRAH AIRPORT and
-- FUJAIRAH NAVY BASE, by their explicit choice. Older rows are
-- null, so nothing here contradicts history.
--
-- Safe to run repeatedly. Additive only: no rows are updated and
-- no default is set, so every existing transaction keeps
-- location = null and renders as '-' in the UI.
--
-- This must run BEFORE warehouse.html saves an OUT transaction,
-- otherwise the insert is rejected with PGRST204
-- (column does not exist).
-- ============================================================

alter table public.transactions
  add column if not exists location text;

comment on column public.transactions.location is
  'Site where the material was used on an OUT transaction. Free text, normally one of the eight known sites. Null for IN and for rows recorded before this column existed.';

-- ------------------------------------------------------------
-- Result, for your records.
-- ------------------------------------------------------------
select c.column_name,
       c.data_type,
       c.is_nullable,
       c.column_default,
       (select count(*) from public.transactions t)                           as rows_total,
       (select count(*) from public.transactions t where t.location is not null) as rows_with_location
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name   = 'transactions'
   and c.column_name  = 'location';
