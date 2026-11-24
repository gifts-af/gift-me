import { describe, expect, it } from "vitest";
import { storeLabel } from "../store-label";

describe("storeLabel", () => {
  it.each([
    ["amazon", "Amazon"],
    ["Amazon", "Amazon"],
    ["walmart", "Walmart"],
    ["etsy.com", "Etsy"],
    // Anything but a plain .com keeps its domain.
    ["shop.example.com", "shop.example.com"],
    ["example.co.uk", "example.co.uk"],
    ["example.org", "example.org"],
  ])("%s reads %s", (stored, shown) => expect(storeLabel(stored)).toBe(shown));

  it.each([null, ""])("nothing for %s", (stored) => expect(storeLabel(stored)).toBeNull());
});
