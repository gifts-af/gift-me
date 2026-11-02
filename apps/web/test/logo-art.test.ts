// @vitest-environment node
import { describe, expect, it } from "vitest";
import { iconSvg } from "@/lib/logo-art";

describe("app icon art (ALL-48)", () => {
  it("is a square SVG at the size asked for", () => {
    const svg = iconSvg(180, { holiday: false });
    expect(svg).toMatch(/^<svg [^>]*width="180" height="180"/);
    expect(svg).toContain('viewBox="0 0 96 96"');
  });

  it("is the yellow AF tag with a heart on near-black", () => {
    const svg = iconSvg(180, { holiday: false });
    expect(svg).toContain('fill="#18181b"');
    expect(svg).toContain('data-part="tag" fill="#facc15"');
    expect(svg).toContain('data-part="af"');
    expect(svg).toContain('data-heart="yes"');
  });

  it("drops the heart at tab size so AF stays readable", () => {
    expect(iconSvg(32, { holiday: false })).not.toContain('data-heart="yes"');
  });

  it("wears the hat and holly only in the holiday season", () => {
    expect(iconSvg(180, { holiday: false })).not.toContain('data-part="hat"');
    const festive = iconSvg(180, { holiday: true });
    expect(festive).toContain('data-part="hat"');
    expect(festive).toContain('data-part="holly"');
  });

  it("keeps the hat but skips the holly at tab size", () => {
    const tab = iconSvg(32, { holiday: true });
    expect(tab).toContain('data-part="hat"');
    expect(tab).not.toContain('data-part="holly"');
  });

  it("can fill the square edge to edge for install icons", () => {
    expect(iconSvg(512, { holiday: false, rounded: false })).toContain('rx="0"');
    expect(iconSvg(32, { holiday: false, rounded: true })).toContain('rx="22"');
  });
});
