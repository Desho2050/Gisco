-- ============================================================
-- GISCO migration - step 9
-- Daily overtime: tasks and the employees who worked each one
--
-- Two new tables. Nothing existing is read, altered or updated,
-- so this is safe to run against the live database and safe to
-- run more than once.
--
--   public.overtime_tasks    one row per task: date, site, what
--                            was done, the shared start and end
--                            times on site
--   public.overtime_entries  one row per employee per task,
--                            carrying that person's overtime
--                            hours. This is the table every
--                            report reads.
--
-- WHY TWO TABLES AND NOT ONE
-- A task normally covers a whole crew at one site for one window,
-- but a man who left early works fewer hours than his mates. The
-- shared facts (date, site, description, times) live on the task;
-- the per-person fact (hours) lives on the entry. Adding five men
-- to a task means one task row and five entry rows, and the hours
-- on each entry may differ from the task's own window.
--
-- work_date is deliberately DUPLICATED on overtime_entries.
-- Without it every month or per-employee report has to reach
-- through the foreign key to filter, which PostgREST can only do
-- with an embedded filter and no useful index. Filtering and
-- grouping happen on overtime_entries.work_date alone, so the
-- column has to be there. Overtime.html rewrites it whenever a
-- task's date changes, so the copy cannot drift.
--
-- Employee identity is SNAPSHOT, not a foreign key: emps.code
-- (file number) plus the Arabic and English names as they read
-- when the overtime was recorded. emps has no delete protection,
-- so a person can be removed from EMP.html while the overtime
-- register must still say who worked. Same choice as db/007 and
-- db/005.
--
-- NOTE ON ACCESS: Row Level Security is still off across this
-- database (db/003 has not been applied), so these two tables are
-- readable and writable with the anon key like every other table
-- here. db/003 has been updated to include both when it is run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The task - shared facts for a crew working one site
-- ------------------------------------------------------------
create table if not exists public.overtime_tasks (
  id              uuid primary key default gen_random_uuid(),
  work_date       date    not null default ((now() at time zone 'Asia/Dubai')::date),
  location        text    not null,
  task_desc       text,
  time_start      time,
  time_end        time,
  hours_default   numeric(6,2)
                    constraint overtime_tasks_hours_default_check
                    check (hours_default is null or (hours_default >= 0 and hours_default <= 24)),
  notes           text,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table  public.overtime_tasks is
  'One row per overtime task. The crew and each man''s hours live in public.overtime_entries.';
comment on column public.overtime_tasks.work_date is
  'The day the overtime was worked, not the day it was entered. Defaults to the date in Dubai time regardless of the device clock.';
comment on column public.overtime_tasks.location is
  'Site name as free text - normally one of the known sites in Overtime.html (AL HAIL 43, AL HAIL 73, AL HAIL MUSANDA, FUJAIRAH AIRPORT, FUJAIRAH NAVY BASE, SEIH ALBANAH MUSANADA, SEIH ALBANAH KATEBA, AL JAZEERA AL HAMRAH, THOUBAN), but a site not listed there is still allowed. Same rule as transactions.location in db/006.';
comment on column public.overtime_tasks.task_desc is
  'What the crew actually did, written by the supervisor.';
comment on column public.overtime_tasks.time_start is
  'Shift overtime start on site, 24-hour local clock. Null when the supervisor only knows the hours.';
comment on column public.overtime_tasks.time_end is
  'Overtime end on site. An end earlier than the start means the job ran past midnight; Overtime.html shows the raw duration but stores hours, never a signed interval, so nothing here is ambiguous.';
comment on column public.overtime_tasks.hours_default is
  'The hours the page suggested from time_start/time_end (rounded down to quarter hours) at save time. Audit only - the authoritative figure per man is overtime_entries.ot_hours.';
comment on column public.overtime_tasks.created_by is
  'Username of the signed-in GISCO account that saved the task. Informational only while RLS is off.';

-- ------------------------------------------------------------
-- 2. One row per employee per task
-- ------------------------------------------------------------
create table if not exists public.overtime_entries (
  id                uuid primary key default gen_random_uuid(),
  task_id           uuid    not null
                        constraint overtime_entries_task_id_fkey
                        references public.overtime_tasks (id) on delete cascade,
  work_date         date    not null,
  employee_code     text    not null,
  employee_name     text,
  employee_name_en  text,
  ot_hours          numeric(6,2) not null default 0
                        constraint overtime_entries_ot_hours_check
                        check (ot_hours >= 0 and ot_hours <= 24),
  hours_overridden  boolean not null default false,
  notes             text,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint overtime_entries_task_employee_unique
    unique (task_id, employee_code)
);

comment on table  public.overtime_entries is
  'The overtime hours one employee claims for one task. Every overtime report in Overtime.html aggregates this table.';
comment on column public.overtime_entries.work_date is
  'Copy of overtime_tasks.work_date, kept in step by the page so a month can be read with one indexed range scan instead of an embedded filter. Report queries should use this column, not the task''s.';
comment on column public.overtime_entries.employee_code is
  'emps.code - the file number the warehouse and EMP pages search by. A snapshot, not a foreign key.';
comment on column public.overtime_entries.employee_name is
  'emps.name as it read when the overtime was recorded - normally the Arabic name.';
comment on column public.overtime_entries.employee_name_en is
  'emps.name2 as it read at the same moment - the English name, for prints and CSV.';
comment on column public.overtime_entries.ot_hours is
  'Hours this man worked beyond his shift. Normally the task window rounded down to quarter hours; see hours_overridden.';
comment on column public.overtime_entries.hours_overridden is
  'True when a supervisor typed a figure different from the task window (a man who left early, or a job with no clean clock-in). Lets a report separate entered-by-hand hours from calculated ones.';

-- ------------------------------------------------------------
-- 3. Keys and lookup paths
-- ------------------------------------------------------------
-- The daily view opens on one date and the month views scan a
-- range, both on the entries table.
create index if not exists overtime_tasks_work_date_idx
  on public.overtime_tasks (work_date desc, location);

create index if not exists overtime_entries_work_date_idx
  on public.overtime_entries (work_date desc);

-- "This man's overtime, this month" - the per-employee report.
create index if not exists overtime_entries_employee_date_idx
  on public.overtime_entries (employee_code, work_date desc);

create index if not exists overtime_entries_task_idx
  on public.overtime_entries (task_id);

-- Keep updated_at honest; the trigger function already exists
-- (created in db/001, used by other tables).
drop trigger if exists overtime_tasks_set_updated_at on public.overtime_tasks;
create trigger overtime_tasks_set_updated_at
  before update on public.overtime_tasks
  for each row execute function public.update_updated_at_column();

drop trigger if exists overtime_entries_set_updated_at on public.overtime_entries;
create trigger overtime_entries_set_updated_at
  before update on public.overtime_entries
  for each row execute function public.update_updated_at_column();

-- ------------------------------------------------------------
-- 4. Result, for your records.
-- ------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'overtime_tasks')   as task_columns,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'overtime_entries') as entry_columns,
  (select count(*) from pg_indexes
    where schemaname = 'public'
      and tablename in ('overtime_tasks','overtime_entries'))          as indexes,
  (select count(*) from public.overtime_tasks)   as task_rows,
  (select count(*) from public.overtime_entries) as entry_rows;
