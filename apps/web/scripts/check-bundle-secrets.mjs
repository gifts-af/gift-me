// Fails if the browser code could leak a Zinc key or reveal the Vault-reading
// SQL functions (ALL-32, AC-6). Run after `pnpm build`: `pnpm check:bundle`.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", ".next", "static");
const banned = [
  { name: "a Zinc key prefix (zn_)", pattern: /\bzn_[A-Za-z0-9]{8,}/ },
  { name: "zinc_secrets", pattern: /zinc_secrets/ },
  { name: "zinc_store_secrets", pattern: /zinc_store_secrets/ },
  { name: "zinc_secret_by_webhook", pattern: /zinc_secret_by_webhook/ },
];

if (!existsSync(root)) {
  console.error(`No build output at ${root}. Run pnpm build first.`);
  process.exit(1);
}

function* files(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(js|css|html|json|map|txt)$/.test(e.name)) yield p;
  }
}

let scanned = 0;
const hits = [];
for (const file of files(root)) {
  scanned++;
  const text = readFileSync(file, "utf8");
  for (const b of banned) if (b.pattern.test(text)) hits.push(`${b.name} in ${file}`);
}

if (hits.length) {
  console.error(`Secrets check failed:\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`Bundle check passed: ${scanned} files in .next/static, no Zinc key or Vault function names.`);
