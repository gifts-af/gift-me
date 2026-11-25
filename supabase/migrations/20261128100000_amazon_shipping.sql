-- Zinc's lookup calls Amazon shipping free on items that are then charged for it (a $15.49 gift was
-- refused at checkout over $6.99 of shipping), so cheap gifts were capped too low to buy (ALL-29).
insert into concierge.app_settings (key, value, description) values
  ('amazon_free_shipping_from_cents', '3500',
   'Amazon items priced below this count amazon_shipping_estimate_cents when the lookup says shipping is free. 0 always takes the lookup''s word.'),
  ('amazon_shipping_estimate_cents', '699',
   'The shipping counted for an Amazon item below amazon_free_shipping_from_cents whose lookup says free, in cents.')
on conflict (key) do nothing;
