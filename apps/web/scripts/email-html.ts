// Writes one HTML file per email sample into a folder, for the phone-layout
// test (e2e/emails.spec.ts, ALL-60). Usage: pnpm --filter @gifts-af/web email:html <folder>
// Runs under tsx with --conditions=react-server, like email-samples.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sampleFormEmails } from "@/lib/form-email-samples";
import { sampleEmails } from "@/modules/concierge";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: pnpm --filter @gifts-af/web email:html <folder>");
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
for (const { name, email } of sampleEmails("https://giftsaf.com/a/sample")) {
  writeFileSync(path.join(dir, `${name}.html`), email.html);
}
// The public forms' emails (ALL-71).
for (const { name, html } of sampleFormEmails()) {
  writeFileSync(path.join(dir, `${name}.html`), html);
}
