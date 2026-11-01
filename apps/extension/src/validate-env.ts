export const REQUIRED_ENV = [
  "VITE_APP_ORIGIN",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_EXTENSION_KEY",
  "VITE_CAPTURE_JPEG_QUALITY",
] as const;

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

// Vite also reads .env.local files and shell VITE_* variables, which win over
// the committed files. This catches a stray one before it ships.
// `committedProduction` is the parsed .env.production.
export function validateEnv(
  mode: string,
  env: Record<string, string | undefined>,
  committedProduction: Record<string, string>,
): void {
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required env var(s) for mode "${mode}": ${missing.join(", ")}. Set them in apps/extension/.env.${mode}.`);
  }

  const origin = env.VITE_APP_ORIGIN!;
  let bare = false;
  try {
    bare = new URL(origin).origin === origin && !origin.includes("*");
  } catch {
    // not a URL
  }
  if (!bare) {
    throw new Error(`VITE_APP_ORIGIN must be a bare origin like https://giftsaf.com (no path, trailing slash or wildcard), got "${origin}".`);
  }

  const quality = env.VITE_CAPTURE_JPEG_QUALITY!;
  if (!/^\d+$/.test(quality) || Number(quality) < 1 || Number(quality) > 100) {
    throw new Error(`VITE_CAPTURE_JPEG_QUALITY must be a whole number from 1 to 100, got "${quality}".`);
  }

  if (mode === "production") {
    for (const name of REQUIRED_ENV) {
      if (env[name] !== committedProduction[name]) {
        throw new Error(
          `Production build refused: ${name} differs from apps/extension/.env.production. ` +
            `Remove any .env.local / .env.production.local file or shell VITE_* variable that overrides it.`,
        );
      }
    }
  }
}
