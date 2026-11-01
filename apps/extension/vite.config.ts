import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { buildManifest } from "./src/manifest";
import { extensionIdFromKey } from "./src/extension-id";

const REQUIRED = [
  "VITE_APP_ORIGIN",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_EXTENSION_KEY",
  "VITE_CAPTURE_JPEG_QUALITY",
] as const;

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
  const env = loadEnv(mode, __dirname, "VITE_");
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required env var(s) for mode "${mode}": ${missing.join(", ")}. Set them in apps/extension/.env.${mode}.`);
  }

  return {
    root: __dirname,
    plugins: [react(), manifestPlugin(env)],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: resolve(__dirname, "src/popup/index.html"),
          background: resolve(__dirname, "src/background.ts"),
        },
        output: {
          // The service worker keeps a stable name; the manifest points at it.
          entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
          // Everything the worker imports is inlined into background.js.
          manualChunks: undefined,
        },
      },
    },
  };
});
