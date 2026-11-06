// Throwaway spike code for ALL-32 (Task 3, Step 0). Not production code.
// Facts check against Zinc's free sandbox: lookup by our own reference (metadata),
// idempotency replay, wallet fields, webhook set/clear, order totals vs fee,
// sandbox key auth, rate-limit headers. Sandbox (zn_test_) keys only. Keys are
// never printed; the key is kept in spikes/checkout/.zinc-key (gitignored).
//
// Usage: node spikes/checkout/zinc-facts.mjs

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const API = 'https://api.zinc.com';
const KEY_FILE = fileURLToPath(new URL('./.zinc-key', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Redact anything that looks like a key or secret before printing.
const clean = (v) => JSON.stringify(v, null, 1)
  .replace(/zn_(test|live|whsec)_[A-Za-z0-9_-]+/g, 'zn_$1_<redacted>')
  .replace(/("(?:api_key|key|claim_url|secret|webhook_secret|device_code)":\s*")[^"]+/g, '$1<redacted>');
const show = (label, r) => console.log(`\n## ${label} -> ${r.status}\n${clean(r.json).slice(0, 1800)}`);

async function call(method, path, key, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  const rl = {};
  for (const [k, v] of res.headers) if (/ratelimit|retry-after/i.test(k)) rl[k] = v;
  return { status: res.status, json, rl };
}

const address = {
  first_name: 'Test', last_name: 'Recipient', address_line1: '1600 Amphitheatre Pkwy',
  city: 'Mountain View', state: 'CA', postal_code: '94043', country: 'US', phone_number: '6505550100',
};
const orderBody = (scenario, extra = {}) => ({
  products: [{ url: `https://zinc.com/shop/products/${scenario}`, quantity: 1 }],
  max_price: 5000, shipping_address: address, is_gift: true, fulfillment: { gift: 'best_effort' }, ...extra,
});
const items = (j) => (Array.isArray(j) ? j : j.orders ?? j.items ?? j.data ?? []);

async function main() {
  // Q6: mint needs no auth. Mint with no Authorization header; show field names only.
  const mint = await call('POST', '/sandbox/keys', null, { name: 'gift-concierge ALL-32 facts' });
  console.log('\n## POST /sandbox/keys (no auth) ->', mint.status, 'fields:', Object.keys(mint.json ?? {}).join(','), mint.rl);
  let key;
  if (mint.status < 300) { key = mint.json.api_key; writeFileSync(KEY_FILE, key); }
  else if (existsSync(KEY_FILE)) key = readFileSync(KEY_FILE, 'utf8').trim();
  else throw new Error('no key');

  // Q3: wallet
  const wallet = await call('GET', '/wallet/me', key);
  show('GET /wallet/me', wallet); console.log('rate headers:', wallet.rl);

  // Q1/Q5: order with our reference in metadata + idempotency_key
  const ref = 'ref-' + randomUUID().slice(0, 8);
  const idem = randomUUID();
  const body = orderBody('test-success', { idempotency_key: idem, metadata: { gc_ref: ref } });
  const t0 = Date.now();
  const o1 = await call('POST', '/orders', key, body);
  console.log(`\n(create took ${Date.now() - t0}ms)`); show('POST /orders (idem key + metadata)', o1);
  const id = o1.json.id;

  // Q1: lookups while processing
  show('GET /orders/{id} immediately', await call('GET', `/orders/${id}`, key));
  show('GET /orders?metadata_key=gc_ref&metadata_value=ref', await call('GET', `/orders?metadata_key=gc_ref&metadata_value=${ref}`, key));
  show('GET /orders?metadata match nothing', await call('GET', '/orders?metadata_key=gc_ref&metadata_value=nope', key));
  show('GET /orders/{idempotency_key} (as id)', await call('GET', `/orders/${idem}`, key));
  show('GET /orders?idempotency_key=', await call('GET', `/orders?idempotency_key=${idem}`, key));
  const bogus = await call('GET', `/orders?idempotency_key=${randomUUID()}`, key);
  console.log('list with a WRONG idempotency_key returns', items(bogus.json).length, 'orders (1 = filter ignored)');

  // Q2: replay same key, sequentially; then same key with a different body
  show('REPLAY same idempotency_key', await call('POST', '/orders', key, body));
  show('REPLAY same key, different max_price', await call('POST', '/orders', key, { ...body, max_price: 4000 }));

  // Q2: two concurrent sends with a new key
  const idem2 = randomUUID();
  const b2 = orderBody('test-success', { idempotency_key: idem2, metadata: { gc_ref: 'race-' + ref } });
  const [r1, r2] = await Promise.all([call('POST', '/orders', key, b2), call('POST', '/orders', key, b2)]);
  show('RACE send A', r1); show('RACE send B', r2);
  const raced = await call('GET', `/orders?metadata_key=gc_ref&metadata_value=race-${ref}`, key);
  console.log('orders matching race ref:', items(raced.json).length);

  // Q2: 402 insufficient funds caching
  const b3 = orderBody('test-insufficient-funds', { idempotency_key: randomUUID(), metadata: { gc_ref: 'nofunds-' + ref } });
  show('402 first', await call('POST', '/orders', key, b3));
  show('402 retry same key', await call('POST', '/orders', key, b3));
  const nf = await call('GET', `/orders?metadata_key=gc_ref&metadata_value=nofunds-${ref}`, key);
  console.log('orders stored for the 402 key:', items(nf.json).length);

  // Q1: failed order lookup shape
  const f = await call('POST', '/orders', key, orderBody('test-out-of-stock', { idempotency_key: randomUUID(), metadata: { gc_ref: 'fail-' + ref } }));
  let fo;
  for (let i = 0; i < 15; i++) {
    fo = await call('GET', `/orders/${f.json.id}`, key);
    if (/fail/.test(fo.json.status)) break;
    await sleep(2000);
  }
  show('failed order GET', fo);

  // Poll the main order until delivered; show placed shape + totals
  let po;
  for (let i = 0; i < 20; i++) {
    po = await call('GET', `/orders/${id}`, key);
    if ((po.json.tracking_numbers ?? []).some((t) => t.status === 'delivered')) break;
    await sleep(3000);
  }
  show('placed order GET', po);
  const l = await call('GET', `/orders?metadata_key=gc_ref&metadata_value=${ref}`, key);
  console.log('\nlist envelope keys:', Array.isArray(l.json) ? '(array)' : Object.keys(l.json).join(','),
    '| list item keys:', Object.keys(items(l.json)[0] ?? {}).join(','));

  // Q4: webhook endpoint
  show('GET /webhooks/endpoint (before)', await call('GET', '/webhooks/endpoint', key));
  show('PUT /webhooks/endpoint', await call('PUT', '/webhooks/endpoint', key, { url: 'https://example.com/zinc/webhook' }));
  show('PUT again (replace)', await call('PUT', '/webhooks/endpoint', key, { url: 'https://example.com/zinc/webhook2' }));
  const del = await call('DELETE', '/webhooks/endpoint', key);
  console.log('\n## DELETE /webhooks/endpoint ->', del.status);
  show('GET /webhooks/endpoint (after clear)', await call('GET', '/webhooks/endpoint', key));

  // Q6: device code with a sandbox key
  const dc = await call('POST', '/device/code', key, { name: 'gift-concierge ALL-32 facts' });
  console.log('\n## POST /device/code (sandbox key) ->', dc.status, 'fields:', Object.keys(dc.json ?? {}).join(','));
  const dt = await call('POST', '/device/token', null, { device_code: dc.json.device_code });
  show('POST /device/token (before approval)', dt);
  show('GET /sandbox/status', await call('GET', '/sandbox/status', key));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
