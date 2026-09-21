-- A listed material's quantity, written the way it is said.
--
-- The materials list is informative: "½ bolsa", "2 o 3 m2", "1/4", "a
-- definir". `quantity` stays numeric because the charged lines multiply it by
-- their price, so what is written for a listed line goes here instead, and is
-- what the list and the PDF print when it is set.
--
-- Running this twice is safe.
alter table public.budget_items
  add column if not exists quantity_text text;

alter table public.budget_items
  drop constraint if exists budget_items_quantity_text_length;

alter table public.budget_items
  add constraint budget_items_quantity_text_length
  check (quantity_text is null or char_length(quantity_text) between 1 and 40);

comment on column public.budget_items.quantity_text is
  'Quantity as written for a listed line, e.g. "1/2" or "2 o 3"; printed instead of quantity';
