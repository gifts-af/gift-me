import { describe, expect, it } from "vitest";
import { storeLabel } from "../store-label";

describe("storeLabel", () => {
  it.each([
    ["amazon", "Amazon"],
    ["Amazon", "Amazon"],
    ["walmart", "Walmart"],
    ["etsy.com", "Etsy"],
    // More than a name and an ending: the domain says more than a guess would.
    ["shop.example.com", "shop.example.com"],
    ["example.co.uk", "example.co.uk"],
    ["example.org", "example.org"],
  ])("%s reads %s", (stored, shown) => expect(storeLabel(stored)).toBe(shown));

  it.each([null, ""])("nothing for %s", (stored) => expect(storeLabel(stored)).toBeNull());
});
