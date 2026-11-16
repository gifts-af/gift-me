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
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^On .+ wrote:$/.test(line)) break;
    // Gmail often wraps the attribution: "On ... <jim@x.com>" then "wrote:" on the next line.
    if (/^On /.test(line)) {
      const next = lines.slice(i + 1).find((l) => l.trim() !== "");
      if (next !== undefined && /^wrote:$/.test(next.trim())) break;
    }
    if (/^\s*>/.test(lines[i])) continue;
    kept.push(lines[i]);
  }
  return kept.join("\n").trim();
}

const FORWARD_MARKER = /^-{2,}\s*(Forwarded message|Original Message)\s*-{2,}$/i;
const FORWARD_HEADER = /^(From|To|Cc|Bcc|Sent|Date|Subject):/i;
const EMAIL_ADDRESS = /[\p{L}\p{N}._%+'-]+@[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+/giu;

/**
 * Keeps other people's details out of the saved note and the AI (T42): drops the header lines
 * (From:, To:, Cc:, Bcc:, Sent:, Date:, Subject:) right after a "Forwarded message" or
 * "Original Message" line, and turns every email address left in the text into "[email]".
 */
export function redactForwardHeaders(text: string): string {
  const kept: string[] = [];
  let inHeaders = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (FORWARD_MARKER.test(trimmed)) {
      inHeaders = true;
      kept.push(line);
      continue;
    }
    if (inHeaders) {
      if (FORWARD_HEADER.test(trimmed)) continue;
      // Blank lines before the headers stay; the first other line ends them.
      if (trimmed !== "") inHeaders = false;
    }
    kept.push(line);
  }
  return kept.join("\n").replace(EMAIL_ADDRESS, "[email]");
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

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/**
 * The people a note names, in people order. A full name always counts. A first name counts
 * unless a full-name match already covers someone with that first name, so "Bob Smith" doesn't
 * also pick Bob Jones, while "Dad and Jennifer" still picks Jennifer Lopez.
 */
export function matchPeople(
  subject: string,
  body: string,
  people: { id: string; name: string }[],
): string[] {
  const text = `${subject}\n${body}`;
  const fullIds = new Set(people.filter((p) => hasName(text, p.name)).map((p) => p.id));
  const coveredFirsts = new Set(
    people.filter((p) => fullIds.has(p.id)).map((p) => firstName(p.name).toLowerCase()),
  );
  const ids: string[] = [];
  for (const p of people) {
    const first = firstName(p.name);
    const byFirst = !coveredFirsts.has(first.toLowerCase()) && hasName(text, first);
    if ((fullIds.has(p.id) || byFirst) && !ids.includes(p.id)) ids.push(p.id);
  }
  return ids;
}

/** Phrases that mean "don't act on this". Kept short on purpose; review here. */
export const CANCEL_PHRASES = [
  "please cancel",
  "cancel it",
  "cancel this",
  "cancel that",
  "cancel the gift",
  "cancel the order",
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
  for (const att of atts) {
    const type = (att.content_type ?? "").split(";")[0].trim().toLowerCase();
    if (IMAGE_TYPES.has(type) && att.size <= maxBytes) return { id: att.id, content_type: type };
  }
  return null;
}
