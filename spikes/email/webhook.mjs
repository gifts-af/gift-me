// ALL-18 spike: a tiny inbound-email webhook receiver.
// Verifies Resend's Svix signature on the raw body, then fetches the
// email body and attachments by email_id (the webhook carries metadata only).
//
// Run: node spikes/email/webhook.mjs   (reads spikes/email/.env)
// Expose it with a tunnel, e.g. cloudflared tunnel --url http://localhost:8787
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const env = Object.fromEntries(
  fs.readFileSync(path.join(here, '.env'), 'utf8')
    .split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const API = 'https://api.resend.com';
const auth = { Authorization: `Bearer ${env.RESEND_API_KEY}` };
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });

// Svix scheme: HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`, keyed with
// the base64 part of whsec_..., compared against each "v1,<sig>" in the header.
function verify(raw, headers, secret) {
  const id = headers['svix-id'];
  const ts = headers['svix-timestamp'];
  const sigs = headers['svix-signature'];
  if (!id || !ts || !sigs) return 'missing svix headers';
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return 'timestamp outside 5 min (replay?)';
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest();
  const ok = sigs.split(' ').some((s) => {
    const [ver, b64] = s.split(',');
    const got = Buffer.from(b64 ?? '', 'base64');
    return ver === 'v1' && got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
  return ok ? null : 'bad signature';
}

async function handleReceived(data) {
  const t0 = Date.now();
  const email = await (await fetch(`${API}/emails/receiving/${data.email_id}`, { headers: auth })).json();
  const atts = await (await fetch(`${API}/emails/receiving/${data.email_id}/attachments`, { headers: auth })).json();
  const saved = [];
  for (const a of atts.data ?? []) {
    const buf = Buffer.from(await (await fetch(a.download_url)).arrayBuffer());
    const file = path.join(outDir, `${data.email_id}-${a.filename}`);
    fs.writeFileSync(file, buf);
    saved.push({ filename: a.filename, content_type: a.content_type, size: a.size, downloaded: buf.length, expires_at: a.expires_at });
  }
  const summary = {
    email_id: data.email_id,
    from: email.from, display_from: email.headers?.from, to: email.to, received_for: email.received_for,
    subject: email.subject, text: email.text, html_length: email.html?.length ?? 0,
    authentication: email.authentication, attachments: saved, fetch_ms: Date.now() - t0,
  };
  fs.writeFileSync(path.join(outDir, `${data.email_id}.json`), JSON.stringify({ webhook: data, email, attachments: atts }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    const err = verify(raw, req.headers, env.RESEND_WEBHOOK_SECRET ?? '');
    console.log(new Date().toISOString(), req.method, req.url, err ? `REJECTED: ${err}` : 'signature OK');
    if (err) { res.writeHead(401).end(err); return; }
    res.writeHead(200).end('ok'); // ack fast, then do the work
    const evt = JSON.parse(raw);
    console.log('event', evt.type);
    if (evt.type === 'email.received') await handleReceived(evt.data).catch((e) => console.error(e));
  });
}).listen(8787, () => console.log('listening on :8787'));
