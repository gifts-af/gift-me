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
