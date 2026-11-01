// @vitest-environment node
import { describe, expect, it } from "vitest";
import { feedbackHref } from "@/lib/brand";

describe("contact links", () => {
  it("opens a feedback email with an encoded subject", () => {
    expect(feedbackHref()).toBe("mailto:allensforever711@gmail.com?subject=GiftsAF%20alpha%20feedback");
  });

});
