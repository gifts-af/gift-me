import { createHash } from "node:crypto";

// Chrome's extension ID: the first 32 hex digits of sha256(public key DER),
// with each digit 0-f written as a-p. Used by tests and the build only.
export function extensionIdFromKey(base64Key: string): string {
  const hex = createHash("sha256").update(Buffer.from(base64Key, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join("");
}
