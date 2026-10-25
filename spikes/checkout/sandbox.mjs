// Throwaway spike code for ALL-16 (W1-2). Not production code; delete once Wave 4 lands.
// Runs the Zinc v2 sandbox end to end: mint a free test key, check the wallet,
// look up a product's offers, place gift orders for each test scenario, and poll
// each order until it settles. No account or real money involved.
//
// Usage: node spikes/checkout/sandbox.mjs
// Live mode later: ZINC_API_KEY=zn_live_... node spikes/checkout/sandbox.mjs --live <product-url> <max-price-cents>

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://api.zinc.com';
const KEY_FILE = fileURLToPath(new URL('./.zinc-key', import.meta.url));

async function call(method, path, key, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function sandboxKey() {
  if (existsSync(KEY_FILE)) return readFileSync(KEY_FILE, 'utf8').trim();
  const { status, json } = await call('POST', '/sandbox/keys', null, { name: 'gift-concierge ALL-16 spike' });
  if (status >= 300) throw new Error(`mint failed ${status}: ${JSON.stringify(json)}`);
  writeFileSync(KEY_FILE, json.api_key);
  console.log('Minted sandbox key. claim_url (only shown once):', json.claim_url);
  return json.api_key;
}

const address = {
  first_name: 'Test', last_name: 'Recipient',
  address_line1: '1600 Amphitheatre Pkwy', city: 'Mountain View',
  state: 'CA', postal_code: '94043', country: 'US', phone_number: '6505550100',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function placeAndWatch(key, url, maxPrice) {
  const order = await call('POST', '/orders', key, {
    products: [{ url, quantity: 1 }],
    max_price: maxPrice,
    shipping_address: address,
    is_gift: true,
    gift_message: 'Happy birthday from Gift Concierge!',
    fulfillment: { gift: 'best_effort' },
    metadata: { round_id: 'spike-round-1' },
  });
  console.log(`\nPOST /orders ${url} -> ${order.status}`);
  if (order.status >= 300) { console.log(JSON.stringify(order.json, null, 2)); return; }
  const id = order.json.id;
  for (let i = 0; i < 20; i++) {
    const { json } = await call('GET', `/orders/${id}`, key);
    // Order status stops at order_placed; shipment progress lives on tracking_numbers[].status.
    const tracking = json.tracking_numbers ?? [];
    const settled = json.status !== 'pending' && json.status !== 'in_progress' &&
      (json.status !== 'order_placed' || tracking.some((t) => t.status === 'delivered'));
    if (settled) {
      console.log(JSON.stringify({ status: json.status, result: json.result ?? json.job_result, tracking }, null, 2));
      return json;
    }
    await sleep(3000);
  }
  console.log('Still processing after 60s:', id);
}

async function main() {
  const live = process.argv[2] === '--live';
  const key = live ? process.env.ZINC_API_KEY : await sandboxKey();
  if (!key) throw new Error('Set ZINC_API_KEY for --live');

  const wallet = await call('GET', '/wallet/me', key);
  console.log('GET /wallet/me ->', wallet.status, JSON.stringify(wallet.json));

  if (live) {
    const [, , , url, maxPrice] = process.argv;
    await placeAndWatch(key, url, Number(maxPrice));
    return;
  }

  const tests = await call('GET', '/orders/test-products', key);
  console.log('Test products:', (tests.json.products ?? []).map((p) => p.scenario).join(', '));

  // Offer lookup returns realistic sample data in test mode.
  const search = await call('GET', '/products/search?retailer=amazon&query=' + encodeURIComponent('cozy throw blanket'), key);
  const first = search.json?.results?.[0] ?? search.json?.products?.[0];
  console.log('\nGET /products/search ->', search.status, first ? JSON.stringify(first).slice(0, 400) : JSON.stringify(search.json).slice(0, 400));
  if (first?.product_id) {
    const offers = await call('GET', `/products/${first.product_id}/offers?retailer=amazon`, key);
    console.log('GET /offers ->', offers.status, JSON.stringify(offers.json).slice(0, 800));
  }

  for (const scenario of ['test-success', 'test-price-exceeded', 'test-out-of-stock', 'test-insufficient-funds']) {
    await placeAndWatch(key, `https://zinc.com/shop/products/${scenario}`, 5000);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
