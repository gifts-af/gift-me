import { describe, expect, it } from "vitest";
import type { PaymentSummary } from "@/modules/concierge";
import { paymentRowText } from "../rows";

describe("paymentRowText (ALL-115 AC-9)", () => {
  const cases: [PaymentSummary | "error", string][] = [
    ["not_allowed", "Not available yet"],
    ["off", "Not available yet"],
    ["paused", "Paused"],
    ["not_connected", "Not set up"],
    ["waiting", "Connecting"],
    ["needs_phone", "Add your phone"],
    ["connected", "Connected"],
    ["error", "Couldn't load"],
  ];
  it.each(cases)("%s reads %s", (summary, text) => {
    expect(paymentRowText(summary)).toBe(text);
  });
});

import { addressRowText } from "../rows";

describe("addressRowText (ALL-115 AC-6)", () => {
  it("shows the street line", () => {
    const address = { firstName: "Sam", lastName: "R", line1: "44 Elm St", line2: "", city: "Columbus", state: "OH", zip: "43215" };
    expect(addressRowText({ kind: "saved", address, shared: false })).toBe("44 Elm St");
  });
  it("says Not added with no address", () => {
    expect(addressRowText({ kind: "none" })).toBe("Not added");
  });
  it("says Couldn't load when the read failed", () => {
    expect(addressRowText({ kind: "unavailable" })).toBe("Couldn't load");
  });
});
