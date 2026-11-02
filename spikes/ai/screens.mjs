// Takes the phone-size screenshots for `run.mjs screens` (ALL-42).
// Usage: node spikes/ai/screens.mjs
// The two real product pages are git-ignored (the repo is public; their images
// aren't ours to republish), so run this to recreate them. The mock post is committed.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium, devices } = require('@playwright/test');
const out = fileURLToPath(new URL('./fixtures/screens/', import.meta.url));

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();

// Two real product pages, as someone would screenshot them on a phone.
for (const [file, url] of [
  ['onyx-product.png', 'https://onyxcoffeelab.com/products/tropical-weather'],
  ['ciele-product.png', 'https://cieleathletics.com/collections/gocap'],
]) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: out + file });
    console.log('ok', file, await page.title());
  } catch (e) {
    console.log('fail', file, e.message.split('\n')[0]);
  }
}

// A mock social post built from the dad-1 text fixture (no real account involved).
const caps = JSON.parse(readFileSync(new URL('./fixtures/captures.json', import.meta.url), 'utf8'));
const dad = caps.find((c) => c.id === 'dad-1');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
await page.setContent(`<body style="margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fff">
  <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #eee">
    <div style="width:32px;height:32px;border-radius:50%;background:#c7a17a"></div><b>dave.on.the.fly</b>
  </div>
  <div style="height:300px;background:linear-gradient(135deg,#6b8e5a,#2f4a2a);display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px">[photo: fly-tying desk, a dozen dry flies]</div>
  <p style="padding:12px;font-size:15px;line-height:1.4;white-space:pre-wrap">${esc(dad.text_excerpt)}</p>
</body>`);
await page.screenshot({ path: out + 'dad-post-mock.png', fullPage: true });
console.log('ok dad-post-mock.png');
await browser.close();
