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
-- pricing_factors
--
-- Site conditions that move the price of a job: a flat, nowhere to park,
-- hours imposed by the client. They are how the number is reached, not line
-- items the customer sees.
-- -----------------------------------------------------------------------------
create table if not exists public.pricing_factors (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  label       text not null,
  description text,
  -- What it adds, e.g. 40 for "a flat costs 40% more".
  percent     numeric(6, 2) not null check (percent >= -100 and percent <= 500),
  -- Which part of the budget it is computed on.
  applies_to  text not null check (applies_to in ('labor', 'materials')),
  -- Conditions sharing a group are alternatives: buying the materials costs
  -- 15% in the province and 20% in the capital, never both.
  exclusive_group text,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists pricing_factors_sort_order_idx
  on public.pricing_factors (sort_order, label);

create or replace trigger pricing_factors_set_updated_at
  before update on public.pricing_factors
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
  currency      char(3) not null default 'ARS',
  tax_rate      numeric(5, 2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  -- subtotal is maintained by the budget_items trigger below.
  subtotal      numeric(14, 2) not null default 0,
  tax_amount    numeric(14, 2) generated always as (round(subtotal * tax_rate / 100, 2)) stored,
  total         numeric(14, 2) generated always as (subtotal + round(subtotal * tax_rate / 100, 2)) stored,
  valid_until   date,
  -- The conditions that applied, frozen the way prices are frozen onto the
  -- lines: changing a percentage later must not rewrite old quotes.
  site_factors  jsonb not null default '[]'::jsonb,
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
  -- Bullet lines covered by this price, one per line, and the condition that
  -- travels next to it: a quote written by hand reads that way.
  detail           text,
  note             text,
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
alter table public.pricing_factors enable row level security;

-- -----------------------------------------------------------------------------
-- Seed data: the conditions that move a price, with their percentages
-- -----------------------------------------------------------------------------
insert into public.pricing_factors
  (code, label, description, percent, applies_to, exclusive_group, sort_order)
values
  ('departamento', 'Departamento',
   'La obra es en un departamento: ascensor, escaleras y subir materiales',
   40, 'labor', null, 10),
  ('sin_estacionamiento', 'Sin lugar para estacionar',
   'No hay dónde dejar la camioneta cerca de la obra',
   40, 'labor', null, 20),
  ('horarios_restringidos', 'Horarios restringidos',
   'El cliente o la administración imponen los horarios de trabajo',
   50, 'labor', null, 30),
  ('compra_materiales_provincia', 'Compra de materiales · Provincia',
   'Los materiales los compra el contratista, para una obra en provincia',
   15, 'materials', 'compra_materiales', 40),
  ('compra_materiales_capital', 'Compra de materiales · Capital',
   'Los materiales los compra el contratista, para una obra en Capital',
   20, 'materials', 'compra_materiales', 50)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Seed data: construction materials with initial unit prices in ARS
-- -----------------------------------------------------------------------------
insert into public.materials (code, name, description, category, unit, unit_price) values
  ('MAT-CEM-001', 'Cemento Loma Negra CPC40 50 kg',      'Bolsa de 50 kg de cemento de uso general',                'Materiales de agarre', 'bolsa',  18500.00),
  ('MAT-CEM-002', 'Cemento blanco Avellaneda 25 kg',     'Bolsa de 25 kg de cemento blanco para terminaciones',     'Materiales de agarre', 'bolsa',  22400.00),
  ('MAT-CAL-001', 'Cal hidratada Cacique 25 kg',         'Bolsa de 25 kg de cal hidratada para morteros',           'Materiales de agarre', 'bolsa',   9600.00),
  ('MAT-YES-001', 'Yeso Tuyango 40 kg',                  'Bolsa de 40 kg de yeso para interiores',                  'Materiales de agarre', 'bolsa',  12300.00),
  ('MAT-MOR-001', 'Mortero premezclado Weber 30 kg',     'Bolsa de 30 kg de mortero seco para mampostería',         'Materiales de agarre', 'bolsa',  14200.00),
  ('MAT-PEG-001', 'Pegamento Klaukol impermeable 30 kg', 'Bolsa de 30 kg de adhesivo para cerámicos y porcelanato', 'Materiales de agarre', 'bolsa',  16800.00),
  ('MAT-PAS-001', 'Pastina Klaukol 5 kg',                'Bolsa de 5 kg de pastina para juntas',                    'Materiales de agarre', 'bolsa',   7900.00),
  ('MAT-ARE-001', 'Arena fina',                          'Arena fina para revoques y mezclas',                      'Áridos',               'm3',     42000.00),
  ('MAT-ARE-002', 'Arena gruesa',                        'Arena gruesa para contrapisos y hormigón',                'Áridos',               'm3',     45000.00),
  ('MAT-PIE-001', 'Piedra partida 6-20',                 'Piedra partida para hormigón',                            'Áridos',               'm3',     58000.00),
  ('MAT-HOR-001', 'Hormigón elaborado H-21',             'Hormigón elaborado entregado en obra',                    'Hormigón',             'm3',    148000.00),
  ('MAT-LAD-001', 'Ladrillo común 5x12x25',              'Ladrillo común de campo',                                 'Albañilería',          'u',        380.00),
  ('MAT-LAD-002', 'Ladrillo hueco 12x18x33',             'Ladrillo cerámico hueco de 12 cm para tabiques',          'Albañilería',          'u',        980.00),
  ('MAT-LAD-003', 'Ladrillo hueco 8x18x33',              'Ladrillo cerámico hueco de 8 cm para tabiques',           'Albañilería',          'u',        790.00),
  ('MAT-BLO-001', 'Bloque de hormigón 19x19x39',         'Bloque de hormigón hueco para mampostería',               'Albañilería',          'u',       1950.00),
  ('MAT-HIE-001', 'Hierro aletado del 8 - barra 12 m',   'Barra de acero conformado ADN 420 de 8 mm',               'Hierros',              'u',      14500.00),
  ('MAT-MAL-001', 'Malla Sima Q-188 2x5 m',              'Panel de malla electrosoldada para contrapisos',          'Hierros',              'u',      79000.00),
  ('MAT-DUR-001', 'Placa de yeso Durlock 12,5 mm',       'Placa estándar de 1,20 x 2,40 m',                         'Durlock',              'u',      28500.00),
  ('MAT-DUR-002', 'Perfil montante 70 mm - 2,60 m',      'Perfil galvanizado para tabiques de Durlock',             'Durlock',              'u',       9700.00),
  ('MAT-POR-001', 'Porcelanato 60x60 rectificado',       'Porcelanato esmaltado para pisos interiores',             'Pisos y revestimientos','m2',     32000.00),
  ('MAT-CER-001', 'Cerámica para pared 20x30',           'Cerámica esmaltada para revestimiento de paredes',        'Pisos y revestimientos','m2',     18500.00),
  ('MAT-PIN-001', 'Látex interior Alba balde 20 l',      'Balde de 20 l de látex lavable blanco',                   'Pintura',              'balde',  92000.00),
  ('MAT-PIN-002', 'Fijador al agua 20 l',                'Balde de 20 l de fijador para paredes nuevas',            'Pintura',              'balde',  48000.00),
  ('MAT-AIS-001', 'Lana de vidrio 50 mm',                'Panel de lana de vidrio para aislación termoacústica',    'Aislaciones',          'm2',     11200.00),
  ('MAT-IMP-001', 'Membrana líquida Sika 20 kg',         'Balde de 20 kg de membrana líquida para techos',          'Impermeabilización',   'balde',  86000.00),
  ('MAT-PVC-001', 'Caño PVC 110 mm x 4 m',               'Caño de PVC para desagües cloacales',                     'Sanitarios',           'u',      22500.00),
  ('MAT-ELE-001', 'Cable unipolar 2,5 mm2',              'Cable de cobre unipolar para instalaciones interiores',   'Electricidad',         'm',       1250.00)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Seed data: standard labor tasks with initial unit prices in ARS
-- -----------------------------------------------------------------------------
insert into public.standard_tasks (code, name, description, trade, unit, labor_unit_price, estimated_hours_per_unit) values
  ('TSK-DEM-001', 'Demolición de tabique',            'Demolición de tabique no portante y retiro de escombros',  'Demolición',         'm2',  12500.00, 0.60),
  ('TSK-ALB-001', 'Levantado de pared de ladrillo',   'Levantado de pared de ladrillo hueco con mezcla',          'Albañilería',        'm2',  23000.00, 1.20),
  ('TSK-ALB-002', 'Levantado de pared de bloques',    'Levantado de pared de bloques de hormigón',                'Albañilería',        'm2',  21000.00, 1.00),
  ('TSK-REV-001', 'Revoque grueso y fino interior',   'Revoque completo sobre paredes interiores',                'Revoques',           'm2',  15500.00, 0.70),
  ('TSK-CAR-001', 'Carpeta de nivelación',            'Carpeta de nivelación sobre contrapiso',                   'Revoques',           'm2',  11500.00, 0.50),
  ('TSK-COL-001', 'Colocación de piso',               'Colocación de piso cerámico o porcelanato con pastina',    'Colocación',         'm2',  19500.00, 1.00),
  ('TSK-COL-002', 'Colocación de revestimiento',      'Colocación de revestimiento en paredes con pastina',       'Colocación',         'm2',  21500.00, 1.10),
  ('TSK-DUR-001', 'Tabique de Durlock',               'Armado de tabique de Durlock con perfilería y placas',     'Durlock',            'm2',  24500.00, 1.00),
  ('TSK-PIN-001', 'Pintura látex interior',           'Dos manos de látex sobre superficies preparadas',          'Pintura',            'm2',   7800.00, 0.30),
  ('TSK-PLO-001', 'Boca de agua y desagüe',           'Instalación de una boca de agua fría, caliente y desagüe', 'Plomería',           'u',   68000.00, 3.00),
  ('TSK-ELE-001', 'Boca de luz o tomacorriente',      'Instalación de una boca con cableado y caja',              'Electricidad',       'u',   33000.00, 1.50),
  ('TSK-IMP-001', 'Impermeabilización de losa',       'Aplicación de membrana líquida sobre losa',                'Impermeabilización', 'm2',  16500.00, 0.60)
on conflict (code) do nothing;
