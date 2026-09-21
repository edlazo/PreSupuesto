-- Work packages ("partidas"): one price covers several described tasks.
--
-- A quote written by hand reads as a title, a few bullets under it, and one
-- round number. `detail` holds those bullets, one per line, and `note` the
-- condition that travels next to the price, e.g. "con las restricciones de la
-- administración".
alter table public.budget_items
  add column if not exists detail text,
  add column if not exists note   text;

comment on column public.budget_items.detail is
  'Bullet lines describing the work covered by this price, one per line';
comment on column public.budget_items.note is
  'Condition printed next to the price of this line';
