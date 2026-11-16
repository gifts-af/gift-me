// Pure helpers for inbound email quick capture (ALL-31). No database or network.

export function senderVerified(auth: { spf: string; dkim: string; dmarc: string }): boolean {
  return auth?.dmarc === "pass";
}

const AUTO_PRECEDENCE = new Set(["bulk", "junk", "list", "auto_reply"]);

export function isAutoReply(headers: Record<string, string>): boolean {
  for (const [name, raw] of Object.entries(headers)) {
    const key = name.toLowerCase();
    const value = String(raw).trim().toLowerCase();
    if (key === "auto-submitted" && value !== "" && value !== "no") return true;
    if (key === "precedence" && AUTO_PRECEDENCE.has(value)) return true;
  }
  return false;
}

/** Drops quoted lines (">") and everything from an "On ... wrote:" line. Forwarded content stays. */
export function stripQuoted(text: string): string {
  const kept: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^On .+ wrote:\s*$/.test(line.trim())) break;
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word match, case-insensitive except the first letter must be a capital in the text. */
function hasName(text: string, name: string): boolean {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const pattern = words.map(escapeRegExp).join("\\s+");
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "giu");
  for (const m of text.matchAll(re)) {
    const first = m[0][0];
    if (first !== first.toLowerCase()) return true;
  }
  return false;
}

export function matchPeople(
  subject: string,
  body: string,
  people: { id: string; name: string }[],
): string[] {
  const text = `${subject}\n${body}`;
  const ids: string[] = [];
  for (const person of people) {
    const first = person.name.trim().split(/\s+/)[0] ?? "";
    if ((hasName(text, person.name) || hasName(text, first)) && !ids.includes(person.id)) {
      ids.push(person.id);
    }
  }
  return ids;
}

/** Phrases that mean "don't act on this". Kept short on purpose; review here. */
export const CANCEL_PHRASES = [
  "cancel",
  "don't buy",
  "dont buy",
  "do not buy",
  "skip this",
  "never mind",
  "nevermind",
] as const;

export function looksLikeCancel(text: string): boolean {
  const t = text.toLowerCase().replace(/[\u2018\u2019]/g, "'");
  return CANCEL_PHRASES.some((p) => new RegExp(`(?<![a-z])${escapeRegExp(p)}(?![a-z])`).test(t));
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function firstImage(
  atts: { id: string; content_type: string; size: number }[],
  maxBytes: number,
): { id: string; content_type: string } | null {
  const hit = atts.find((a) => IMAGE_TYPES.has(a.content_type.toLowerCase()) && a.size <= maxBytes);
  return hit ? { id: hit.id, content_type: hit.content_type } : null;
}
