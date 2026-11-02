import { describe, expect, it } from "vitest";
import { buildManifest } from "./manifest";
import { extensionIdFromKey } from "./extension-id";

const env = { appOrigin: "https://giftsaf.com", key: "abc123", name: "GiftsAF" };

describe("buildManifest", () => {
  it("permissions are exactly activeTab, scripting, storage", () => {
    expect(buildManifest(env).permissions).toEqual(["activeTab", "scripting", "storage"]);
  });

  it("no host_permissions or content_scripts", () => {
    const manifest = buildManifest(env);
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("optional_host_permissions");
    expect(manifest).not.toHaveProperty("content_scripts");
  });

  it("externally_connectable matches only the app origin", () => {
    expect(buildManifest(env).externally_connectable).toEqual({
      matches: ["https://giftsaf.com/*"],
    });
  });

  it("key is set", () => {
    expect(buildManifest(env).key).toBe("abc123");
  });

  it("uses a module service worker and the popup", () => {
    const manifest = buildManifest(env);
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toEqual({ service_worker: "background.js", type: "module" });
    expect(manifest.action.default_popup).toBe("src/popup/index.html");
  });
});

describe("extensionIdFromKey", () => {
  it("derives the ID Chrome gives the committed key", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const envFile = readFileSync(fileURLToPath(new URL("../.env.production", import.meta.url)), "utf8");
    const key = /^VITE_EXTENSION_KEY=(.+)$/m.exec(envFile)![1];
    expect(extensionIdFromKey(key)).toBe("nnakijeilmglcmjpdpagacbjannapafb");
  });
});
