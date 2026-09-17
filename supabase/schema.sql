-- =============================================================================
-- PreSupuesto - Database schema (PostgreSQL / Supabase)
--
-- Tables:
--   materials       Catalog of construction materials with current unit prices
--   standard_tasks  Catalog of standard labor tasks (e.g. masonry, plastering)
--   clients         Customers who request budgets
--   budgets         Budget header (client, status, tax, totals)
--   budget_items    Budget lines referencing a material, a task, or free text
--
-- The script is idempotent: it can be run more than once safely.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------

-- Keeps updated_at in sync on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- materials
-- -----------------------------------------------------------------------------
create table if not exists public.materials (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  description text,
  category    text not null,
  unit        text not null,
  unit_price  numeric(12, 2) not null check (unit_price >= 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists materials_category_idx on public.materials (category);
create index if not exists materials_name_idx on public.materials (name);

create or replace trigger materials_set_updated_at
  before update on public.materials
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- standard_tasks
-- -----------------------------------------------------------------------------
create table if not exists public.standard_tasks (
  id                       uuid primary key default gen_random_uuid(),
  code                     text not null unique,
  name                     text not null,
  description              text,
  trade                    text not null,
  unit                     text not null,
  labor_unit_price         numeric(12, 2) not null check (labor_unit_price >= 0),
  estimated_hours_per_unit numeric(8, 2) check (estimated_hours_per_unit >= 0),
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists standard_tasks_trade_idx on public.standard_tasks (trade);

create or replace trigger standard_tasks_set_updated_at
  before update on public.standard_tasks
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- clients
-- -----------------------------------------------------------------------------
create table if not exists public.clients (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null,
  company_name text,
  tax_id       text,
  email        text,
  phone        text,
  address      text,
  city         text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists clients_full_name_idx on public.clients (full_name);
create index if not exists clients_email_idx on public.clients (email);

create or replace trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- budgets
-- -----------------------------------------------------------------------------
create table if not exists public.budgets (
  id            uuid primary key default gen_random_uuid(),
  budget_number bigint generated always as identity unique,
  client_id     uuid not null references public.clients (id) on delete restrict,
  title         text not null,
  description   text,
  site_address  text,
  status        text not null default 'draft'
                check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  currency      char(3) not null default 'EUR',
  tax_rate      numeric(5, 2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  -- subtotal is maintained by the budget_items trigger below.
  subtotal      numeric(14, 2) not null default 0,
  tax_amount    numeric(14, 2) generated always as (round(subtotal * tax_rate / 100, 2)) stored,
  total         numeric(14, 2) generated always as (subtotal + round(subtotal * tax_rate / 100, 2)) stored,
  valid_until   date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists budgets_client_id_idx on public.budgets (client_id);
create index if not exists budgets_status_idx on public.budgets (status);

create or replace trigger budgets_set_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- budget_items
--
-- description, unit and unit_price are snapshots taken when the line is added,
-- so later catalog price changes do not alter existing budgets.
-- -----------------------------------------------------------------------------
create table if not exists public.budget_items (
  id               uuid primary key default gen_random_uuid(),
  budget_id        uuid not null references public.budgets (id) on delete cascade,
  item_type        text not null check (item_type in ('material', 'task', 'custom')),
  material_id      uuid references public.materials (id) on delete restrict,
  standard_task_id uuid references public.standard_tasks (id) on delete restrict,
  description      text not null,
  unit             text not null,
  quantity         numeric(12, 3) not null check (quantity > 0),
  unit_price       numeric(12, 2) not null check (unit_price >= 0),
  line_total       numeric(14, 2) generated always as (round(quantity * unit_price, 2)) stored,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint budget_items_reference_matches_type check (
       (item_type = 'material' and material_id is not null and standard_task_id is null)
    or (item_type = 'task'     and standard_task_id is not null and material_id is null)
    or (item_type = 'custom'   and material_id is null and standard_task_id is null)
  )
);

create index if not exists budget_items_budget_id_idx on public.budget_items (budget_id, sort_order);
create index if not exists budget_items_material_id_idx on public.budget_items (material_id);
create index if not exists budget_items_standard_task_id_idx on public.budget_items (standard_task_id);

create or replace trigger budget_items_set_updated_at
  before update on public.budget_items
  for each row execute function public.set_updated_at();

-- Recalculates budgets.subtotal whenever budget lines change.
create or replace function public.refresh_budget_subtotal()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.budgets b
       set subtotal = coalesce((select sum(line_total) from public.budget_items where budget_id = old.budget_id), 0)
     where b.id = old.budget_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.budget_id is distinct from old.budget_id) then
    update public.budgets b
       set subtotal = coalesce((select sum(line_total) from public.budget_items where budget_id = new.budget_id), 0)
     where b.id = new.budget_id;
  end if;

  return null;
end;
$$;

create or replace trigger budget_items_refresh_subtotal
  after insert or update or delete on public.budget_items
  for each row execute function public.refresh_budget_subtotal();

-- -----------------------------------------------------------------------------
-- Row Level Security
--
-- RLS is enabled with no policies, so the public anon key cannot read or write
-- these tables. The FastAPI backend uses the service role key, which bypasses
-- RLS. Add policies here if the frontend ever queries Supabase directly.
-- -----------------------------------------------------------------------------
alter table public.materials      enable row level security;
alter table public.standard_tasks enable row level security;
alter table public.clients        enable row level security;
alter table public.budgets        enable row level security;
alter table public.budget_items   enable row level security;

-- -----------------------------------------------------------------------------
-- Seed data: construction materials with initial unit prices
-- -----------------------------------------------------------------------------
insert into public.materials (code, name, description, category, unit, unit_price) values
  ('MAT-CEM-001', 'Portland cement CEM II 32.5', '25 kg bag of general-purpose Portland cement', 'binders',     'bag',  6.50),
  ('MAT-CEM-002', 'White cement BL 42.5',        '25 kg bag of white cement for finishes',       'binders',     'bag', 11.90),
  ('MAT-LIM-001', 'Hydrated lime',               '25 kg bag of hydrated building lime',          'binders',     'bag',  7.20),
  ('MAT-PLA-001', 'Gypsum plaster',              '20 kg bag of gypsum plaster for interiors',    'binders',     'bag',  8.40),
  ('MAT-MOR-001', 'Ready-mix masonry mortar M7.5', '25 kg bag of dry masonry mortar',            'mortars',     'bag',  4.80),
  ('MAT-ADH-001', 'Tile adhesive C2TE',           '25 kg bag of flexible cementitious adhesive',  'mortars',     'bag', 14.50),
  ('MAT-GRT-001', 'Tile grout',                  '5 kg bag of cementitious joint grout',         'mortars',     'bag',  9.75),
  ('MAT-AGG-001', 'Washed sand 0/4',             'Fine aggregate for mortar and concrete',       'aggregates',  'm3',  32.00),
  ('MAT-AGG-002', 'Gravel 6/12',                 'Coarse aggregate for concrete',                'aggregates',  'm3',  36.00),
  ('MAT-CON-001', 'Ready-mix concrete HA-25',    'Structural ready-mix concrete delivered on site', 'concrete', 'm3',  95.00),
  ('MAT-BRK-001', 'Solid clay brick',            '24x11.5x5 cm solid facing brick',              'masonry',     'unit',  0.45),
  ('MAT-BRK-002', 'Hollow clay brick',           '24x11.5x7 cm perforated brick',                'masonry',     'unit',  0.28),
  ('MAT-BLK-001', 'Concrete block 40x20x20',     'Hollow concrete masonry block',                'masonry',     'unit',  1.35),
  ('MAT-STL-001', 'Rebar B500S 10 mm',           'Corrugated steel reinforcing bar',             'steel',       'kg',    1.10),
  ('MAT-STL-002', 'Welded wire mesh 15x15 6 mm', '2.5x5 m reinforcing mesh sheet',               'steel',       'm2',    3.20),
  ('MAT-DRY-001', 'Plasterboard 12.5 mm',        'Standard gypsum board 1.2x2.5 m',              'drywall',     'm2',    5.60),
  ('MAT-DRY-002', 'Metal stud 70 mm',            'Galvanized steel stud for partitions',         'drywall',     'm',     2.10),
  ('MAT-TIL-001', 'Porcelain floor tile 60x60',  'Rectified porcelain stoneware tile',           'finishes',    'm2',   22.00),
  ('MAT-TIL-002', 'Ceramic wall tile 20x30',     'Glazed ceramic wall tile',                     'finishes',    'm2',   12.50),
  ('MAT-PNT-001', 'Interior acrylic paint',      'Washable matte white paint',                   'finishes',    'l',     4.90),
  ('MAT-INS-001', 'Mineral wool panel 50 mm',    'Thermal and acoustic insulation panel',        'insulation',  'm2',    6.80),
  ('MAT-WPR-001', 'Waterproofing membrane',      'Liquid elastomeric waterproofing membrane',    'waterproofing', 'kg',  7.40),
  ('MAT-PVC-001', 'PVC drain pipe 110 mm',       'Sanitation PVC pipe, 3 m length',              'plumbing',    'm',     4.25),
  ('MAT-ELE-001', 'Electrical cable 2.5 mm2',    'H07V-K flexible copper cable',                 'electrical',  'm',     0.65)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Seed data: standard labor tasks with initial unit prices
-- -----------------------------------------------------------------------------
insert into public.standard_tasks (code, name, description, trade, unit, labor_unit_price, estimated_hours_per_unit) values
  ('TSK-DEM-001', 'Partition demolition',   'Demolish a non-structural partition and remove debris', 'demolition',    'm2',  18.00, 0.60),
  ('TSK-MAS-001', 'Brick wall construction','Build a brick wall including mortar',                   'masonry',       'm2',  32.00, 1.20),
  ('TSK-MAS-002', 'Block wall construction','Build a concrete block wall',                           'masonry',       'm2',  28.00, 1.00),
  ('TSK-PLA-001', 'Wall plastering',        'Apply and finish plaster on interior walls',            'plastering',    'm2',  16.50, 0.70),
  ('TSK-SCR-001', 'Floor screed',           'Level a floor with mortar screed',                      'plastering',    'm2',  14.00, 0.50),
  ('TSK-TIL-001', 'Floor tiling',           'Lay floor tiles including adhesive and grout',          'tiling',        'm2',  26.00, 1.00),
  ('TSK-TIL-002', 'Wall tiling',            'Lay wall tiles including adhesive and grout',           'tiling',        'm2',  30.00, 1.10),
  ('TSK-DRY-001', 'Plasterboard partition', 'Build a plasterboard partition with metal studs',       'drywall',       'm2',  34.00, 1.00),
  ('TSK-PNT-001', 'Interior painting',      'Two coats of paint on prepared interior surfaces',      'painting',      'm2',   9.50, 0.30),
  ('TSK-PLU-001', 'Plumbing point',         'Install a water supply and drain point',                'plumbing',      'unit',95.00, 3.00),
  ('TSK-ELE-001', 'Electrical point',       'Install a socket or lighting point with wiring',        'electrical',    'unit',48.00, 1.50),
  ('TSK-WPR-001', 'Waterproofing',          'Apply a liquid waterproofing membrane',                 'waterproofing', 'm2',  22.00, 0.60)
on conflict (code) do nothing;
