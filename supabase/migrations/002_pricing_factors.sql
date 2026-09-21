-- Site conditions that move the price of a job.
--
-- The trade prices the same work differently depending on where it happens:
-- a flat, nowhere to park, hours imposed by the client. These are not line
-- items — the customer never sees them — they are how the number is reached.
--
-- Running this twice is safe.
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

alter table public.pricing_factors
  add column if not exists exclusive_group text;

create index if not exists pricing_factors_sort_order_idx
  on public.pricing_factors (sort_order, label);

create or replace trigger pricing_factors_set_updated_at
  before update on public.pricing_factors
  for each row execute function public.set_updated_at();

alter table public.pricing_factors enable row level security;

-- The conditions that applied to a budget, frozen the way prices are frozen
-- onto its lines: changing a percentage later must not rewrite old quotes.
alter table public.budgets
  add column if not exists site_factors jsonb not null default '[]'::jsonb;

comment on column public.budgets.site_factors is
  'Snapshot of the pricing factors applied: [{code, label, percent, applies_to}]';

-- An earlier run of this file created a single materials factor; it is now
-- two, one per zone.
delete from public.pricing_factors where code = 'compra_materiales';

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
