// Structured events (E6): one JSON object per line on stdout, which Vercel
// captures. Ids and counts only: never names, emails, page text or keys (T27).

type Field = string | number | boolean | null;

export function logEvent(event: string, fields: Record<string, Field>): void {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...fields }));
}

const TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * What a failure event says about an error (E6): its name, and its kind, code and status when
 * they are short plain tokens (a ZincError's kind and Zinc code, a Postgres error code), from an
 * Error or a plain error object.
 * Never the message, which can echo a request or personal data.
 */
export function errorFields(e: unknown): Record<string, Field> {
  if (typeof e !== "object" || e === null) return { name: "unknown" };
  // A plain object counts too: Supabase returns its errors that way, with a Postgres code.
  const x = e as { kind?: unknown; code?: unknown; status?: unknown };
  return {
    name: e instanceof Error ? e.name : "unknown",
    ...(typeof x.kind === "string" && TOKEN.test(x.kind) ? { kind: x.kind } : {}),
    ...(typeof x.code === "string" && TOKEN.test(x.code) ? { code: x.code } : {}),
    ...(typeof x.status === "number" && Number.isInteger(x.status) ? { status: x.status } : {}),
  };
}
