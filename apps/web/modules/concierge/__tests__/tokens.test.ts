import { describe, expect, it } from "vitest";
import { hashActionToken, newActionToken } from "../notify/tokens";

describe("action tokens", () => {
  it("makes 43-char URL-safe tokens that differ across 1,000 calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const { token, hash } = newActionToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(hash).toBe(hashActionToken(token));
      seen.add(token);
    }
    expect(seen.size).toBe(1000);
  });

  it("hashes to stable 64-char lowercase hex", () => {
    const h = hashActionToken("abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
