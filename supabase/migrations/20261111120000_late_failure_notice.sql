-- A failure recorded after its round closed is told to the customer (ALL-32
-- final review S2; owner rule: customers are always told what is happening
-- with their purchase). An order still placing at the deadline can fail
-- later (a webhook, or the sweep), and the owner can settle an unconfirmed
-- one as failed (README runbook). reconcile_round resolves such a failure on
-- a closed round and the round ends skipped (or stays ordered next to a gift
-- on its way), so the engine never looks at it again and no email went out.
--
-- fail_order_row now marks the order failed_after_close when its round is
-- closed. The app sends one "we couldn't buy it" email per such order, keyed
-- 'late_fail:<order id>' in round_sends, at once from the webhook or sweep
-- and again from the daily tick until it goes.
--
-- fail_order_row is copied from 20261109100000_zinc_wallet.sql (no later
-- migration changed it); only the marked line is new. Expand-only (E7): a
-- new column with a default, and the same function signature (its grants stay).
-- The column is server-only, like hold_reason: no grant to users.

alter table concierge.orders add column failed_after_close boolean not null default false;

create or replace function concierge.fail_order_row(p_order concierge.orders, p_failure_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid;
begin
  update concierge.orders
     set status = 'failed',
         failure_type = p_failure_type,
         hold_reason = null,
         resolved = (p_failure_type = 'invalid_shipping_address'),
         -- New: the round already closed, so the engine won't tell the buyer; the app does.
         failed_after_close = exists (select 1 from concierge.gift_rounds where id = p_order.round_id and closed_at is not null)
   where id = p_order.id;

  if p_failure_type = 'invalid_shipping_address'
     and not exists (select 1 from concierge.gift_rounds where id = p_order.round_id and closed_at is not null)
     and not exists (select 1 from concierge.orders
                      where idea_id = p_order.idea_id and status not in ('failed', 'cancelled', 'refunded')) then
    insert into concierge.orders (user_id, round_id, idea_id, provider, funding_mode, max_price_cents, is_gift, gift_message,
                                  fee_cents, status, hold_reason, ship_to, ship_city, ship_state)
    values (p_order.user_id, p_order.round_id, p_order.idea_id, p_order.provider, p_order.funding_mode, p_order.max_price_cents,
            p_order.is_gift, p_order.gift_message, p_order.fee_cents, 'held', 'address', p_order.ship_to, p_order.ship_city,
            p_order.ship_state)
    returning id into v_new;
    -- No address snapshot: begin_placing needs a fresh, valid one before it sends.
  end if;
end;
$$;
