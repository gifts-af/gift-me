// @vitest-environment node
import { describe, expect, it } from "vitest";
import { accessRequestHref, feedbackHref } from "@/lib/brand";

describe("contact links", () => {
  it("opens a feedback email with an encoded subject", () => {
    expect(feedbackHref()).toBe("mailto:allensforever711@gmail.com?subject=GiftsAF%20alpha%20feedback");
  });

  it("opens an access request that asks for a name", () => {
    const href = accessRequestHref();
    expect(href.startsWith("mailto:allensforever711@gmail.com?subject=GiftsAF%20access%20request&body=")).toBe(true);
    const body = decodeURIComponent(href.split("&body=")[1]);
    expect(body).toContain("name");
    expect(href.split("&body=")[1]).not.toMatch(/[ ?&]/);
  });
});
