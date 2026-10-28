// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseOverBudgetPct } from "../settings-rules";

describe("parseOverBudgetPct", () => {
  it.each([
    ["0", 0],
    ["15", 15],
    [" 20 ", 20],
    ["100", 100],
  ])("accepts %j", (input, expected) => expect(parseOverBudgetPct(input)).toBe(expected));

  it.each(["-1", "101", "abc", "12.5", "", "1e2"])("rejects %j", (input) =>
    expect(parseOverBudgetPct(input)).toBeNull(),
  );
});
