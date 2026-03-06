-- Supabase schema for KNSN property management
-- Run this in Supabase SQL Editor.
-- Includes:
--  - profiles (role: admin/staff)
--  - properties (standard columns + geocode metadata + raw)
--  - uploads, geocode_jobs scaffolding
--  - RLS policies + trigger to enforce 'staff fills blanks + memo always'

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  role text not null default 'staff' check (role in ('admin','staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
using (id = auth.uid());

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin
on public.profiles
for select
using (public.is_admin());

-- Allow user to create/update their own profile (first-login convenience)
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Properties
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'source_type') then
    create type public.source_type as enum ('auction','onbid','realtor');
  end if;
end $$;

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),

  global_id text not null,
  item_no text not null,
  source_type public.source_type not null,
  is_general boolean not null default false,

  address text not null,
  asset_type text,
  exclusive_area numeric,
  common_area numeric,
  site_area numeric,
  use_approval date,
  status text,

  price_main numeric,
  date_main timestamptz,
  source_url text,
  memo text,

  latitude double precision,
  longitude double precision,

  date_uploaded timestamptz not null default now(),
  assignee_id uuid references public.profiles(id),

  raw jsonb,
  geocode_status text,
  geocode_provider text,
  geocode_updated_at timestamptz,
  geocode_query_address text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists properties_global_id_uq on public.properties(global_id);
create index if not exists properties_assignee_idx on public.properties(assignee_id);
create index if not exists properties_source_idx on public.properties(source_type);
create index if not exists properties_general_idx on public.properties(is_general);

drop trigger if exists trg_properties_updated_at on public.properties;
create trigger trg_properties_updated_at
before update on public.properties
for each row execute function public.set_updated_at();

alter table public.properties enable row level security;

-- SELECT

drop policy if exists properties_select_admin on public.properties;
create policy properties_select_admin
on public.properties
for select
using (public.is_admin());

drop policy if exists properties_select_staff_own on public.properties;
create policy properties_select_staff_own
on public.properties
for select
using (assignee_id = auth.uid());

-- INSERT

drop policy if exists properties_insert_admin on public.properties;
create policy properties_insert_admin
on public.properties
for insert
with check (public.is_admin());

drop policy if exists properties_insert_staff_own on public.properties;
create policy properties_insert_staff_own
on public.properties
for insert
with check (assignee_id = auth.uid());

-- UPDATE

drop policy if exists properties_update_admin on public.properties;
create policy properties_update_admin
on public.properties
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists properties_update_staff_own on public.properties;
create policy properties_update_staff_own
on public.properties
for update
using (assignee_id = auth.uid())
with check (assignee_id = auth.uid());

-- Staff update rule:
-- - memo: always editable
-- - other fields: only editable if old is NULL (i.e. staff can fill blanks)
create or replace function public.enforce_staff_property_update()
returns trigger
language plpgsql
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if new.assignee_id is distinct from auth.uid() then
    raise exception 'not allowed';
  end if;

  -- immutable identity fields for staff
  if new.global_id is distinct from old.global_id then raise exception 'not allowed'; end if;
  if new.item_no is distinct from old.item_no then raise exception 'not allowed'; end if;
  if new.source_type is distinct from old.source_type then raise exception 'not allowed'; end if;
  if new.is_general is distinct from old.is_general then raise exception 'not allowed'; end if;
  if new.date_uploaded is distinct from old.date_uploaded then raise exception 'not allowed'; end if;

  -- if old not null, must not change
  if old.address is not null and new.address is distinct from old.address then raise exception 'not allowed'; end if;
  if old.asset_type is not null and new.asset_type is distinct from old.asset_type then raise exception 'not allowed'; end if;

  if old.exclusive_area is not null and new.exclusive_area is distinct from old.exclusive_area then raise exception 'not allowed'; end if;
  if old.common_area is not null and new.common_area is distinct from old.common_area then raise exception 'not allowed'; end if;
  if old.site_area is not null and new.site_area is distinct from old.site_area then raise exception 'not allowed'; end if;
  if old.use_approval is not null and new.use_approval is distinct from old.use_approval then raise exception 'not allowed'; end if;

  if old.status is not null and new.status is distinct from old.status then raise exception 'not allowed'; end if;
  if old.price_main is not null and new.price_main is distinct from old.price_main then raise exception 'not allowed'; end if;
  if old.date_main is not null and new.date_main is distinct from old.date_main then raise exception 'not allowed'; end if;
  if old.source_url is not null and new.source_url is distinct from old.source_url then raise exception 'not allowed'; end if;

  if old.latitude is not null and new.latitude is distinct from old.latitude then raise exception 'not allowed'; end if;
  if old.longitude is not null and new.longitude is distinct from old.longitude then raise exception 'not allowed'; end if;

  return new;
end $$;

drop trigger if exists trg_properties_staff_enforce on public.properties;
create trigger trg_properties_staff_enforce
before update on public.properties
for each row execute function public.enforce_staff_property_update();

-- ---------------------------------------------------------------------------
-- Uploads (optional)
-- ---------------------------------------------------------------------------
create table if not exists public.uploads (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references public.profiles(id),
  source_type public.source_type not null,
  file_name text,
  row_count int,
  created_at timestamptz not null default now()
);

alter table public.uploads enable row level security;

drop policy if exists uploads_admin_all on public.uploads;
create policy uploads_admin_all
on public.uploads
for all
using (public.is_admin())
with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Geocode jobs (optional scaffolding)
-- ---------------------------------------------------------------------------
create table if not exists public.geocode_jobs (
  id uuid primary key default gen_random_uuid(),
  property_global_id text references public.properties(global_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','ok','failed')),
  provider text,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_geocode_jobs_updated_at on public.geocode_jobs;
create trigger trg_geocode_jobs_updated_at
before update on public.geocode_jobs
for each row execute function public.set_updated_at();

alter table public.geocode_jobs enable row level security;

drop policy if exists geocode_jobs_admin_all on public.geocode_jobs;
create policy geocode_jobs_admin_all
on public.geocode_jobs
for all
using (public.is_admin())
with check (public.is_admin());
