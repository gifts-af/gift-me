// @vitest-environment node
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("web app manifest", () => {
  const m = manifest();

  it("opens Home full-screen once installed", () => {
    expect(m).toMatchObject({ name: "GiftMe", short_name: "GiftMe", start_url: "/", display: "standalone" });
  });

  it("has the 192 and 512 px PNG icons Android needs", () => {
    const sizes = (m.icons ?? []).filter((icon) => icon.type === "image/png").map((icon) => icon.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  it("uses the page colour behind the splash screen", () => {
    expect(m.background_color).toBe("#ffffff");
  });
});
