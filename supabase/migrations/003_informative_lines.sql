-- Materials the customer buys: listed, not charged.
--
-- A quote written by hand ends with "MATERIALES APROX." — quantities and
-- units, no prices — because the customer buys them. Such a line still
-- belongs to the budget, but it must not reach the total.
--
-- Running this twice is safe.
alter table public.budget_items
  add column if not exists is_quoted boolean not null default true;

comment on column public.budget_items.is_quoted is
  'False for a line that is only listed: no price is shown and it adds nothing';

-- `line_total` is generated, so the rule lives in its expression and the
-- subtotal trigger needs no change. The column is rebuilt only when it still
-- carries the old expression.
do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'budget_items'
       and column_name = 'line_total'
       and coalesce(generation_expression, '') not like '%is_quoted%'
  ) then
    alter table public.budget_items drop column line_total;

    alter table public.budget_items
      add column line_total numeric(14, 2)
      generated always as (
        case when is_quoted then round(quantity * unit_price, 2) else 0 end
      ) stored;
  end if;
end
$$;
