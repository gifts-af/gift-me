// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as og from "@/app/opengraph-image";

// ALL-55: LinkedIn wants about 1200 x 627, a PNG, under 5 MB.
describe("share image", () => {
  it("is a 1200 x 630 PNG with alt text", () => {
    expect(og.size).toEqual({ width: 1200, height: 630 });
    expect(og.contentType).toBe("image/png");
    expect(og.alt).toMatch(/GiftsAF/);
  });
});
