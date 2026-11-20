-- "Save" on a suggested idea (ALL-128, planning decision 54). A saved gift
-- copied from an idea keeps the idea's product id (Amazon's ASIN), because
-- on-demand ideas are re-made on every run and their own ids don't last.
-- The Gift ideas screen shows "Saved" by matching on it, and the unique index
-- makes a second save of the same product for the same person fail with 23505,
-- which the app treats as already saved. Gifts typed in by hand have no
-- product id and are never counted as copies.

alter table concierge.saved_gifts
  add column retailer_product_id text check (char_length(retailer_product_id) between 1 and 64);

create unique index saved_gifts_one_per_product_idx
  on concierge.saved_gifts (user_id, person_id, retailer_product_id)
  where retailer_product_id is not null;
