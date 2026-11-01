import { createHash, randomBytes } from "node:crypto";

// One-time action links (ALL-23, AC-14). The raw token goes in the email only;
// we store just its SHA-256 hash, so a leaked table can't be used as links.
export function newActionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashActionToken(token) };
}

export function hashActionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
