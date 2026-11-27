// Card payments must leave every wallet buyer's email exactly as it was (AC-16): every sample email
// but the card ones, rendered now, hashed and compared with the hash taken before card emails.
// A deliberate wallet wording change updates WALLET_HASH in the same commit.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sampleEmails } from "../notify/samples";

const WALLET_HASH = "e2d5ccc07a6421992fc54e93d6b781698d6ea73877b307c5ef2f530eb688164f";

describe("wallet emails", () => {
  it("AC-16: a wallet buyer's emails are byte-for-byte what they were before card payments", () => {
    const all = sampleEmails("https://giftsaf.com/a/sample");
    // Card samples are named "card" and are new, and the owner's health emails aren't a buyer's.
    const body = JSON.stringify(all.filter((s) => !s.name.includes("card") && !s.name.startsWith("health")).map((s) => [s.name, s.email]));
    const hash = createHash("sha256").update(body).digest("hex");
    expect(hash).toBe(WALLET_HASH);
  });
});
