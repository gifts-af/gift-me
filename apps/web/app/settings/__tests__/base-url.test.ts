import { describe, expect, it } from "vitest";
import { baseUrlFrom } from "../base-url";

const h = (entries: Record<string, string>) => new Headers(entries);

describe("baseUrlFrom", () => {
  it("uses http for localhost with no forwarded proto", () => {
    expect(baseUrlFrom(h({ host: "localhost:3000" }))).toBe("http://localhost:3000");
    expect(baseUrlFrom(h({ host: "127.0.0.1" }))).toBe("http://127.0.0.1");
  });
  it("uses the forwarded proto when present", () => {
    expect(baseUrlFrom(h({ host: "preview.vercel.app", "x-forwarded-proto": "https" }))).toBe("https://preview.vercel.app");
  });
  it("takes the first of a comma-separated proto", () => {
    expect(baseUrlFrom(h({ host: "a.example", "x-forwarded-proto": "https, http" }))).toBe("https://a.example");
  });
  it("defaults to https for other hosts", () => {
    expect(baseUrlFrom(h({ host: "a.example" }))).toBe("https://a.example");
  });
  it("returns null without a host", () => {
    expect(baseUrlFrom(h({}))).toBeNull();
  });
});
