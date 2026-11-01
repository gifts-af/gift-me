export type ManifestEnv = { appOrigin: string; key: string; name: string };

// The extension asks Chrome for three permissions and nothing else: no host
// permissions and no content scripts (AC-11). The app talks to it through
// externally_connectable, which only matches the app's own origin.
export function buildManifest(env: ManifestEnv) {
  return {
    manifest_version: 3 as const,
    name: env.name,
    description: "Save what's on screen to a person in GiftsAF.",
    version: "0.1.0",
    key: env.key,
    permissions: ["activeTab", "scripting", "storage"],
    action: { default_title: "Capture for…", default_popup: "src/popup/index.html" },
    background: { service_worker: "background.js", type: "module" as const },
    externally_connectable: { matches: [`${env.appOrigin}/*`] },
  } satisfies chrome.runtime.ManifestV3;
}
