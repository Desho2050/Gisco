-- ============================================================
-- GISCO migration - step 8
-- Company vehicles handed to employees + their transfer history
--
-- Two new tables. Nothing existing is read, altered or updated,
-- so this is safe to run against the live database and safe to
-- run more than once.
--
--   public.company_vehicles  one row per vehicle the company owns
--   public.vehicle_transfers append-only history: who held it,
--                            when it moved, who recorded the move
--
-- WHY NOT public.vehicles
-- public.vehicles belongs to the GPS tracker: tracker.html
-- inserts a row there the moment a driver starts a trip, keyed on
-- vehicle_number, and its driver_name means "who was driving on
-- that trip". An assignment register must not share a table whose
-- rows and driver column another process writes on its own, so
-- this register is deliberately separate. It only READS
-- vehicle_number from public.vehicles to suggest spellings in the
-- form (the page, not the database).
--
-- Employee identity is SNAPSHOT, not a foreign key, exactly as in
-- db/007: the employee code (file no), the EMP ID and the Arabic +
-- English names as they read at the moment of the handover. emps
-- has no delete protection, so a person can be removed from
-- EMP.html while the register must still say whose vehicle it was.
--
-- NOTE ON ACCESS: Row Level Security is still off across this
-- database (db/003 has not been applied), so these two tables are
-- readable and writable with the anon key like every other table
-- here. db/003 has been updated to include both when it is run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The vehicle register
-- ------------------------------------------------------------
create table if not exists public.company_vehicles (
  id               uuid primary key default gen_random_uuid(),
  vehicle_number   text    not null,
  status           text    not null default 'ASSIGNED'
                     constraint company_vehicles_status_check
                     check (status in ('ASSIGNED','RETURNED','FAULTY','LOST')),
  employee_code    text,
  employee_id      text,
  employee_name    text,
  employee_name_en text,
  handover_date    date,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table  public.company_vehicles is
  'Company vehicles and who holds each one right now. History lives in public.vehicle_transfers. Separate from public.vehicles, which belongs to the GPS tracker.';
comment on column public.company_vehicles.vehicle_number is
  'The internal vehicle number, e.g. 68054. Unique ignoring surrounding spaces, and blank-safe so an empty string cannot collide with another empty string.';
comment on column public.company_vehicles.status is
  'ASSIGNED with an employee, RETURNED to the company, FAULTY, LOST. Enforced by company_vehicles_status_check.';
comment on column public.company_vehicles.employee_code is
  'emps.code - the file number the warehouse and EMP pages search by. A snapshot, not a foreign key.';
comment on column public.company_vehicles.employee_id is
  'emps.employeeid as it read at the same moment, kept so the register survives a roster edit.';
comment on column public.company_vehicles.employee_name is
  'emps.name as it read when the vehicle was handed over - normally the Arabic name.';
comment on column public.company_vehicles.employee_name_en is
  'emps.name2 as it read at the same moment - the English name, for prints and CSV.';
comment on column public.company_vehicles.handover_date is
  'Date the current holder received the vehicle. Rewritten on every transfer, so it always describes the current assignment.';

-- ------------------------------------------------------------
-- 2. Transfer history - append only, never updated
-- ------------------------------------------------------------
create table if not exists public.vehicle_transfers (
  id            uuid primary key default gen_random_uuid(),
  vehicle_id    uuid    not null
                  constraint vehicle_transfers_vehicle_id_fkey
                  references public.company_vehicles (id) on delete cascade,
  from_code     text,
  from_name     text,
  to_code       text,
  to_name       text,
  transfer_date date    not null default ((now() at time zone 'Asia/Dubai')::date),
  notes         text,
  recorded_by   text,
  created_at    timestamptz not null default now()
);

comment on table  public.vehicle_transfers is
  'Every movement of a company vehicle. The row that creates a vehicle has from_code null ("issued to"); a vehicle taken back has to_code null ("returned from").';
comment on column public.vehicle_transfers.transfer_date is
  'Business date of the handover, in Dubai time regardless of the device clock.';
comment on column public.vehicle_transfers.recorded_by is
  'Username of the signed-in GISCO account that saved the row. Informational only while RLS is off.';

-- ------------------------------------------------------------
-- 3. Keys and lookup paths
-- ------------------------------------------------------------
-- Blank-safe uniqueness: nullif() turns '' into null, and a unique
-- index does not compare nulls, so one vehicle with an accidental
-- blank number cannot block the next blank row.
create unique index if not exists company_vehicles_number_uidx
  on public.company_vehicles (nullif(btrim(vehicle_number), ''));

create index if not exists company_vehicles_employee_code_idx
  on public.company_vehicles (employee_code);

create index if not exists company_vehicles_status_idx
  on public.company_vehicles (status);

create index if not exists vehicle_transfers_vehicle_date_idx
  on public.vehicle_transfers (vehicle_id, transfer_date, created_at);

-- Keep updated_at honest; the trigger function already exists
-- (created before this migration, used by other tables).
drop trigger if exists company_vehicles_set_updated_at on public.company_vehicles;
create trigger company_vehicles_set_updated_at
  before update on public.company_vehicles
  for each row execute function public.update_updated_at_column();

-- ------------------------------------------------------------
-- 4. Result, for your records.
-- ------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'company_vehicles')   as vehicle_columns,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'vehicle_transfers')  as transfer_columns,
  (select count(*) from pg_indexes
    where schemaname = 'public' and tablename in ('company_vehicles','vehicle_transfers')) as indexes,
  (select count(*) from public.company_vehicles)   as vehicle_rows,
  (select count(*) from public.vehicle_transfers)  as transfer_rows,
  (select count(*) from public.vehicles)           as tracker_vehicles_untouched;
