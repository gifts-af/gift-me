// Builds the production extension and zips it for the Chrome Web Store
// (ALL-65): pnpm --filter @gifts-af/extension package
// The store sets the extension ID itself and rejects a manifest "key", so the
// zip's manifest drops it. Unpacked builds keep the key, which is the store's
// own public key, so every build has the same ID (T69).
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { zipSync } from "fflate";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist");
execSync("pnpm build", { cwd: root, stdio: "inherit" });

const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
delete manifest.key;

const files: Record<string, Uint8Array> = {};
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files[relative(dist, path).replaceAll("\\", "/")] = readFileSync(path);
  }
};
walk(dist);
files["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));

const zipPath = join(root, `giftsaf-extension-${manifest.version}.zip`);
writeFileSync(zipPath, zipSync(files, { level: 9 }));
console.log(`Store zip: ${zipPath}`);
