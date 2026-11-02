import { defineConfig } from "vitest/config";

// Tests do not need the build config (and its required env vars).
export default defineConfig({ test: { environment: "node" } });
