// Structured events (E6): one JSON object per line on stdout, which Vercel
// captures. Ids and counts only: never names, emails, page text or keys (T27).

type Field = string | number | boolean | null;

export function logEvent(event: string, fields: Record<string, Field>): void {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...fields }));
}
