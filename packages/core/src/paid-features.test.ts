import { describe, expect, it } from "vitest";
import { CAPTURE_READ_OFF, captureReadNotice, centsLabel } from "./paid-features";

describe("centsLabel", () => {
  it("shows cents under a dollar and dollars from there", () => {
    expect(centsLabel(2)).toBe("2¢");
    expect(centsLabel(99)).toBe("99¢");
    expect(centsLabel(100)).toBe("$1.00");
    expect(centsLabel(150)).toBe("$1.50");
  });
});

describe("the alpha wording", () => {
  it("says real money is spent, and about how much", () => {
    expect(captureReadNotice(2)).toBe("Alpha: we read each capture with AI, which spends real money, about 2¢ each.");
  });

  it("says why reading is off", () => {
    expect(CAPTURE_READ_OFF).toBe("Reading captures spends real money, so during alpha it's only on for test accounts.");
  });
});
