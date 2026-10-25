// Throwaway spike code for ALL-16. Zinc's "go live" sign-in (device code flow):
// prints a link for a person to click Allow, then polls until Zinc hands over the
// live key, which is saved to .zinc-key-live (gitignored). Sending the sandbox key
// attaches the sandbox to the new account and unlocks the $5 starter credit.
//
// Usage: node spikes/checkout/go-live.mjs

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://api.zinc.com';
const SANDBOX_KEY = fileURLToPath(new URL('./.zinc-key', import.meta.url));
const LIVE_KEY = fileURLToPath(new URL('./.zinc-key-live', import.meta.url));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body, key) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function main() {
  if (existsSync(LIVE_KEY)) return console.log('Live key already saved.');
  const sandboxKey = existsSync(SANDBOX_KEY) ? readFileSync(SANDBOX_KEY, 'utf8').trim() : undefined;

  const { status, json } = await post('/device/code', { name: 'gift-concierge ALL-16 spike' }, sandboxKey);
  if (status >= 300) throw new Error(`device code failed ${status}: ${JSON.stringify(json)}`);
  console.log(`\nOPEN THIS LINK AND CLICK ALLOW (expires in ${Math.round(json.expires_in / 60)} min):\n${json.verification_uri_complete}\n`);

  let interval = (json.interval ?? 5) * 1000;
  for (;;) {
    await sleep(interval);
    const r = await post('/device/token', { device_code: json.device_code });
    // The live key comes back once, in `key`. Never print it.
    const liveKey = r.json.key ?? r.json.api_key;
    if (r.status < 300 && liveKey) {
      writeFileSync(LIVE_KEY, liveKey);
      const { key, api_key, ...rest } = r.json;
      console.log('Approved. Live key saved to .zinc-key-live.', JSON.stringify(rest, null, 2));
      return;
    }
    // Zinc nests it: {"error": {"code": "authorization_pending", ...}}
    const code = r.json.error?.code ?? r.json.error ?? r.json.code;
    if (code === 'authorization_pending') continue;
    if (code === 'slow_down') { interval += 5000; continue; }
    throw new Error(`stopped: ${r.status} ${JSON.stringify(r.json)}`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
