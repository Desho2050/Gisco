-- ============================================================
-- GISCO migration - step 7
-- Company SIM cards + their transfer history
--
-- Two new tables. Nothing existing is read, altered or updated,
-- so this is safe to run against the live database and safe to
-- run more than once.
--
--   public.sim_cards     one row per physical SIM the company owns
--   public.sim_transfers append-only history: who held it, when it
--                        moved, who recorded the move
--
-- Employee identity is SNAPSHOT, not a foreign key. sim_cards and
-- sim_transfers both store the employee code (file no), the EMP ID,
-- and the Arabic + English names as they read at the moment of the
-- handover. emps has no delete protection today, so a person can be
-- removed from EMP.html; the SIM register must still say whose line
-- it was. This is the same choice already made for
-- transactions.receiver in db/005.
--
-- NOTE ON ACCESS: Row Level Security is still off across this
-- database (db/003 has not been applied), so these two tables are
-- readable and writable with the anon key like every other table
-- here. db/003 has been updated to include both when it is run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The SIM register
-- ------------------------------------------------------------
create table if not exists public.sim_cards (
  id               uuid primary key default gen_random_uuid(),
  sim_number       text    not null,
  serial_number    text,
  operator_name    text,
  status           text    not null default 'ACTIVE'
                     constraint sim_cards_status_check
                     check (status in ('ACTIVE','RETURNED','FAULTY','LOST')),
  employee_code    text,
  employee_id      text,
  employee_name    text,
  employee_name_en text,
  handover_date    date,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table  public.sim_cards is
  'Company SIM cards and who holds each one right now. History lives in public.sim_transfers.';
comment on column public.sim_cards.sim_number is
  'The mobile number printed on the SIM. Unique ignoring surrounding spaces, and blank-safe so an empty string cannot collide with another empty string.';
comment on column public.sim_cards.serial_number is
  'Optional SIM serial / ICCID from the card carrier, as written by the operator.';
comment on column public.sim_cards.status is
  'ACTIVE with an employee, RETURNED to the company, FAULTY, LOST. Enforced by sim_cards_status_check.';
comment on column public.sim_cards.employee_code is
  'emps.code - the file number the warehouse and EMP pages search by. A snapshot, not a foreign key.';
comment on column public.sim_cards.employee_name is
  'emps.name as it read when the SIM was handed over - normally the Arabic name.';
comment on column public.sim_cards.employee_name_en is
  'emps.name2 as it read at the same moment - the English name, for prints and CSV.';
comment on column public.sim_cards.handover_date is
  'Date the current holder received the SIM. Rewritten on every transfer, so it always describes the current assignment.';

-- ------------------------------------------------------------
-- 2. Transfer history - append only, never updated
-- ------------------------------------------------------------
create table if not exists public.sim_transfers (
  id            uuid primary key default gen_random_uuid(),
  sim_id        uuid    not null
                  constraint sim_transfers_sim_id_fkey
                  references public.sim_cards (id) on delete cascade,
  from_code     text,
  from_name     text,
  to_code       text,
  to_name       text,
  transfer_date date    not null default ((now() at time zone 'Asia/Dubai')::date),
  notes         text,
  recorded_by   text,
  created_at    timestamptz not null default now()
);

comment on table  public.sim_transfers is
  'Every movement of a SIM. The row that creates a card has from_code null ("issued to"); a card taken back has to_code null ("returned from").';
comment on column public.sim_transfers.transfer_date is
  'Business date of the handover, in Dubai time regardless of the device clock.';
comment on column public.sim_transfers.recorded_by is
  'Username of the signed-in GISCO account that saved the row. Informational only while RLS is off.';

-- ------------------------------------------------------------
-- 3. Keys and lookup paths
-- ------------------------------------------------------------
-- Blank-safe uniqueness: nullif() turns '' into null, and a unique
-- index does not compare nulls, so an accidentally empty serial
-- column on one card cannot block the next card.
create unique index if not exists sim_cards_sim_number_uidx
  on public.sim_cards (nullif(btrim(sim_number), ''));

create index if not exists sim_cards_employee_code_idx
  on public.sim_cards (employee_code);

create index if not exists sim_cards_status_idx
  on public.sim_cards (status);

create index if not exists sim_transfers_sim_date_idx
  on public.sim_transfers (sim_id, transfer_date, created_at);

-- Keep updated_at honest; the trigger function already exists
-- (created before this migration, used by other tables).
drop trigger if exists sim_cards_set_updated_at on public.sim_cards;
create trigger sim_cards_set_updated_at
  before update on public.sim_cards
  for each row execute function public.update_updated_at_column();

-- ------------------------------------------------------------
-- 4. Result, for your records.
-- ------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'sim_cards')     as sim_card_columns,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'sim_transfers') as transfer_columns,
  (select count(*) from pg_indexes
    where schemaname = 'public' and tablename in ('sim_cards','sim_transfers')) as indexes,
  (select count(*) from public.sim_cards)     as sim_rows,
  (select count(*) from public.sim_transfers) as transfer_rows;
