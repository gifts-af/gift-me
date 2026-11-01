-- The budget is the buyer's own, and optional (product decision 36, ALL-44).
-- A null budget means "no budget": nothing is over budget, and each order is
-- capped at the total the user approved instead (design §4.2).

alter table concierge.gift_rounds alter column budget_cents drop not null;
comment on column concierge.gift_rounds.budget_cents is
  'The buyer''s budget for this round, copied from budgets or budget_defaults when the round starts. Null means no budget.';

-- A row with a null amount means "no budget for this person and occasion",
-- even when the relationship has a default. No row means "use the default".
-- budget_defaults keeps its not-null amount: no row there means no default.
alter table concierge.budgets alter column amount_cents drop not null;
comment on column concierge.budgets.amount_cents is
  'Null means no budget for this person and occasion, overriding any relationship default.';
