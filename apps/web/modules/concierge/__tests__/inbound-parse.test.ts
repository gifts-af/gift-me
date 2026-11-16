// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CANCEL_PHRASES,
  firstImage,
  isAutoReply,
  looksLikeCancel,
  matchPeople,
  senderVerified,
  stripQuoted,
} from "../inbound/parse";

describe("senderVerified", () => {
  it("is true only when dmarc passes", () => {
    expect(senderVerified({ spf: "fail", dkim: "fail", dmarc: "pass" })).toBe(true);
    expect(senderVerified({ spf: "pass", dkim: "pass", dmarc: "fail" })).toBe(false);
    expect(senderVerified({ spf: "pass", dkim: "pass", dmarc: "none" })).toBe(false);
    expect(senderVerified({ spf: "pass", dkim: "pass" } as never)).toBe(false);
  });
});

describe("stripQuoted", () => {
  it("drops quoted lines and everything from an 'On ... wrote:' line", () => {
    const text = "Dad wants a fly rod\n> old text\nOn Mon, Jan 5, 2026 at 9:00 AM Jim <j@x.com> wrote:\nanything\nelse";
    expect(stripQuoted(text)).toBe("Dad wants a fly rod");
  });
  it("keeps a forwarded message", () => {
    const text = "Idea for Mom\n---------- Forwarded message ----------\nFrom: Shop\nA nice scarf";
    expect(stripQuoted(text)).toBe(text);
  });
});

describe("isAutoReply", () => {
  it("reads Auto-Submitted", () => {
    expect(isAutoReply({ "Auto-Submitted": "auto-replied" })).toBe(true);
    expect(isAutoReply({ "Auto-Submitted": "no" })).toBe(false);
  });
  it("reads Precedence, case-insensitively", () => {
    expect(isAutoReply({ precedence: "bulk" })).toBe(true);
    expect(isAutoReply({ Precedence: "Junk" })).toBe(true);
    expect(isAutoReply({ PRECEDENCE: "list" })).toBe(true);
    expect(isAutoReply({ Precedence: "auto_reply" })).toBe(true);
    expect(isAutoReply({ Precedence: "first-class" })).toBe(false);
  });
  it("is false with no headers", () => {
    expect(isAutoReply({})).toBe(false);
  });
});

describe("matchPeople", () => {
  const p = (id: string, name: string) => ({ id, name });
  it("matches a single-word name", () => {
    expect(matchPeople("", "Dad wants a fly rod", [p("1", "Dad")])).toEqual(["1"]);
  });
  it("matches first name and full name, in subject or body", () => {
    const people = [p("1", "Jennifer Lopez")];
    expect(matchPeople("Gift for Jennifer", "", people)).toEqual(["1"]);
    expect(matchPeople("", "Jennifer Lopez likes tea", people)).toEqual(["1"]);
  });
  it("needs a whole word", () => {
    expect(matchPeople("", "Jennifer likes tea", [p("1", "Jenn")])).toEqual([]);
  });
  it("needs a capital first letter", () => {
    expect(matchPeople("", "we will see", [p("1", "Will")])).toEqual([]);
    expect(matchPeople("", "Will would like a book", [p("1", "Will")])).toEqual(["1"]);
  });
  it("returns unique ids in people order", () => {
    const people = [p("1", "Mom"), p("2", "Dad")];
    expect(matchPeople("Dad", "Mom and Dad and Mom", people)).toEqual(["1", "2"]);
  });
  it("returns [] when nothing matches", () => {
    expect(matchPeople("hi", "a fly rod", [p("1", "Dad")])).toEqual([]);
  });
});

describe("looksLikeCancel", () => {
  it("spots cancel phrases", () => {
    expect(looksLikeCancel("don't buy it")).toBe(true);
    expect(looksLikeCancel("Please cancel")).toBe(true);
    expect(looksLikeCancel("skip this one")).toBe(true);
    expect(CANCEL_PHRASES.length).toBeGreaterThan(0);
  });
  it("ignores normal notes", () => {
    expect(looksLikeCancel("a fly rod")).toBe(false);
  });
});

describe("firstImage", () => {
  const a = (id: string, content_type: string, size: number) => ({ id, content_type, size });
  it("skips non-images and oversize images", () => {
    const atts = [a("pdf", "application/pdf", 10), a("big", "image/png", 5000), a("ok", "image/webp", 100)];
    expect(firstImage(atts, 1000)).toEqual({ id: "ok", content_type: "image/webp" });
  });
  it("returns null when none qualify", () => {
    expect(firstImage([a("svg", "image/svg+xml", 1)], 1000)).toBeNull();
    expect(firstImage([], 1000)).toBeNull();
  });
});
