import { describe, expect, it } from "vitest";
import { CAPTURE_READ_OFF, captureReadNotice, centsLabel, dollarsLabel, topUpFeeLabel, zincFeeNotice } from "./paid-features";

describe("centsLabel", () => {
  it("shows cents under a dollar and dollars from there", () => {
    expect(centsLabel(2)).toBe("2¢");
    expect(centsLabel(99)).toBe("99¢");
    expect(centsLabel(100)).toBe("$1.00");
    expect(centsLabel(150)).toBe("$1.50");
  });
});

describe("the money wording (no Alpha label, ALL-114 in ALL-116)", () => {
  it("says real money is spent, and about how much", () => {
    expect(captureReadNotice(2)).toBe("We read each capture with AI, which costs real money: about 2¢ each.");
  });

  it("says why reading is off", () => {
    expect(CAPTURE_READ_OFF).toBe("Reading captures costs real money, so for now it's only on for test accounts.");
  });
});

describe("the Zinc wallet wording (ALL-32)", () => {
  it("drops the cents from whole-dollar amounts", () => {
    expect(dollarsLabel(100)).toBe("$1");
    expect(dollarsLabel(10100)).toBe("$101");
    expect(dollarsLabel(4050)).toBe("$40.50");
    expect(dollarsLabel(0)).toBe("$0");
  });

  it("says each gift costs its price plus Zinc's fee", () => {
    expect(zincFeeNotice(100)).toBe("Each gift costs its price plus Zinc's $1 order fee, taken from your Zinc balance.");
  });
});

describe("topUpFeeLabel", () => {
  it("joins the percent and the fixed part", () => {
    expect(topUpFeeLabel(290, 30)).toBe("2.9% + 30¢");
    expect(topUpFeeLabel(300, 100)).toBe("3% + $1.00");
  });
});
