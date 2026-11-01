function required(name: string): string {
  const value = import.meta.env[name] as string | undefined;
  if (!value) throw new Error(`Missing required env var ${name}.`);
  return value;
}

// Validated at build time too (see validate-env.ts); no defaults here.
export const config = {
  appOrigin: required("VITE_APP_ORIGIN"),
  supabaseUrl: required("VITE_SUPABASE_URL"),
  supabaseKey: required("VITE_SUPABASE_PUBLISHABLE_KEY"),
  jpegQuality: Number(required("VITE_CAPTURE_JPEG_QUALITY")),
};
