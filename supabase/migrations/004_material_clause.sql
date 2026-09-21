-- Buying the materials is stated, not calculated.
--
-- What the materials cost is the contractor's business and never reaches a
-- budget, so a percentage over their value cannot be worked out here. The
-- handwritten sheet says as much in words — "COSTO POR COMPRAR MATERIALES 15%
-- DEL VALOR DE LOS MISMOS" — so these conditions become a sentence printed on
-- the quote instead of a multiplier.
--
-- Running this twice is safe.
alter table public.pricing_factors
  drop constraint if exists pricing_factors_applies_to_check;

alter table public.pricing_factors
  add constraint pricing_factors_applies_to_check
  check (applies_to in ('labor', 'materials', 'note'));

-- The sentence to print. `{percent}` is replaced with the factor's own
-- percentage, so tuning it keeps the wording in step.
alter table public.pricing_factors
  add column if not exists clause text;

comment on column public.pricing_factors.clause is
  'Sentence printed on the quote for a note factor; {percent} is substituted';

update public.pricing_factors
   set applies_to = 'note',
       clause = 'Por la compra de materiales se cobra un {percent}% del valor de los mismos.'
 where code in ('compra_materiales_provincia', 'compra_materiales_capital');
