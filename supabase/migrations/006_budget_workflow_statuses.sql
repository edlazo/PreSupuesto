-- Budget statuses as the job actually moves: quoted, being done, done and paid.
--
--   draft        Borrador            — being written, or sent and waiting
--   in_progress  En proceso          — the customer said yes; work under way
--   completed    Terminado / cobrado — finished and paid
--
-- The earlier set (sent, accepted, rejected, expired) was never offered in the
-- app. Any row still carrying one is mapped first, so the new rule holds:
-- accepted work is under way; anything else goes back to draft.
--
-- Running this twice is safe.
alter table public.budgets
  drop constraint if exists budgets_status_check;

update public.budgets set status = 'in_progress' where status = 'accepted';
update public.budgets set status = 'draft'
 where status not in ('draft', 'in_progress', 'completed');

alter table public.budgets
  add constraint budgets_status_check
  check (status in ('draft', 'in_progress', 'completed'));
