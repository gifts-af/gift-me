import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { buildManifest } from "./src/manifest.ts";
import { extensionIdFromKey } from "./src/extension-id.ts";
import { parseEnvFile, validateEnv } from "./src/validate-env.ts";

// Writes dist/manifest.json from buildManifest, using the mode's env.
function manifestPlugin(env: Record<string, string>): Plugin {
  return {
    name: "write-manifest",
    generateBundle() {
      const manifest = buildManifest({
        appOrigin: env.VITE_APP_ORIGIN,
        key: env.VITE_EXTENSION_KEY,
        name: "GiftsAF",
      });
      this.emitFile({ type: "asset", fileName: "manifest.json", source: JSON.stringify(manifest, null, 2) });
      console.log(`Extension ID: ${extensionIdFromKey(env.VITE_EXTENSION_KEY)}`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "VITE_");
  validateEnv(mode, env, parseEnvFile(readFileSync(resolve(import.meta.dirname, ".env.production"), "utf8")));

  return {
    root: import.meta.dirname,
    plugins: [react(), manifestPlugin(env)],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: resolve(import.meta.dirname, "src/popup/index.html"),
          background: resolve(import.meta.dirname, "src/background.ts"),
        },
        output: {
          // The service worker keeps a stable name; the manifest points at it.
          entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
        },
      },
    },
  };
});
