import { describe, expect, it } from "vitest";
import { FACT_VALUE_MAX, ideaBlock, nextBestIdea, picksBar, rejectionFacts } from "./approval";
import type { ScheduleSettings } from "./schedule";

const s: ScheduleSettings = {
  planningDeliveryDays: 7,
  safetyBufferDays: 2,
  roundLeadDays: 28,
  reminder1AfterHeadsUpDays: 5,
  reminder2BeforeDeadlineDays: 7,
  finalNoticeBeforeDeadlineDays: 2,
  fastestDaysToArrive: 1,
  holdReminderDays: 7,
  holdFinalDays: 2,
};

const ai = (title: string) => ({ title, source: "generated" as const });
const list = (title: string) => ({ title, source: "list" as const });

describe("rejectionFacts", () => {
  it("has_it saves the tapped AI idea's title as owns; a tapped list gift or none saves nothing", () => {
    expect(rejectionFacts("has_it", null, [], ai("Kettle"))).toEqual([{ category: "owns", value: "Kettle" }]);
    expect(rejectionFacts("has_it", null, [], list("Mug"))).toEqual([]);
    expect(rejectionFacts("has_it", null, [], null)).toEqual([]);
  });

  it("not_style names only AI ideas; with only list gifts it saves nothing", () => {
    expect(rejectionFacts("not_style", null, [ai("Kettle"), list("Mug")], null)).toEqual([
      { category: "avoid", value: "Not their style: Kettle" },
    ]);
    // A bare "Not their style" teaches the AI nothing and would count as a fact for a new run.
    expect(rejectionFacts("not_style", null, [list("Mug")], null)).toEqual([]);
  });

  it("not_style and too_generic save one avoid fact naming the titles; too_pricey saves nothing", () => {
    expect(rejectionFacts("not_style", null, [ai("A"), ai("B")], null)).toEqual([
      { category: "avoid", value: "Not their style: A, B" },
    ]);
    expect(rejectionFacts("too_generic", null, [ai("A"), ai("B")], null)).toEqual([
      { category: "avoid", value: "Too generic: A, B" },
    ]);
    expect(rejectionFacts("too_generic", null, [list("A")], null)).toEqual([]);
    expect(rejectionFacts("too_pricey", null, [ai("A")], null)).toEqual([]);
  });

  it("a long title list is cut at a title, within 500 characters", () => {
    const titles = Array.from({ length: 20 }, (_, i) => ai(`Title number ${i} ${"x".repeat(40)}`));
    const [fact] = rejectionFacts("not_style", null, titles, null);
    expect(fact!.value.length).toBeLessThanOrEqual(FACT_VALUE_MAX);
    expect(fact!.value.startsWith("Not their style: Title number 0 ")).toBe(true);
    expect(fact!.value.endsWith("x")).toBe(true);
    expect(fact!.value).not.toMatch(/, $/);
    const last = fact!.value.split(", ").pop()!;
    expect(last).toMatch(/^Title number \d+ x{40}$/);
  });

  it("the free text is its own avoid fact, trimmed; blank adds nothing", () => {
    expect(rejectionFacts("too_pricey", "  Hates scented things  ", [], null)).toEqual([
      { category: "avoid", value: "Hates scented things" },
    ]);
    expect(rejectionFacts("too_pricey", "   ", [], null)).toEqual([]);
    const long = rejectionFacts("too_pricey", "y".repeat(600), [], null);
    expect(long[0]!.value).toHaveLength(FACT_VALUE_MAX);
  });

  it("cuts at 500 characters as the database counts them, never splitting an emoji", () => {
    // With the u flag a whole emoji is one character, so \p{Cs} matches only half of one.
    const loneSurrogate = /\p{Cs}/u;
    const title = `a${"🎁".repeat(600)}`;
    for (const [fact] of [
      rejectionFacts("has_it", null, [], ai(title)),
      rejectionFacts("too_pricey", title, [], null),
      rejectionFacts("not_style", null, [ai(title)], null),
    ]) {
      expect(fact!.value).not.toMatch(loneSurrogate);
      expect([...fact!.value]).toHaveLength(FACT_VALUE_MAX);
    }
  });

  it("an owned AI idea with a blank title saves no owns fact", () => {
    expect(rejectionFacts("has_it", null, [], ai("   "))).toEqual([]);
    expect(rejectionFacts("has_it", null, [], ai("  Kettle "))).toEqual([{ category: "owns", value: "Kettle" }]);
  });

  it("a free text that repeats a generated fact isn't saved twice", () => {
    const facts = rejectionFacts("not_style", "  not their   STYLE: lego set ", [ai("Lego set")], null);
    expect(facts).toEqual([{ category: "avoid", value: "Not their style: Lego set" }]);
  });

  it("FACT_VALUE_MAX is 500", () => {
    expect(FACT_VALUE_MAX).toBe(500);
  });
});

describe("nextBestIdea", () => {
  const ctx = { today: "2026-12-01", occasionDate: "2026-12-25", s };
  const idea = (id: string, rank: number, status: string, d = 2) => ({
    id,
    rank,
    status,
    handlingDaysMax: d,
    deliveryDaysMax: d,
  });

  it("skips rejected, selected and too-slow ideas and takes the lowest rank", () => {
    const ideas = [
      idea("slow", 1, "proposed", 30),
      idea("rej", 2, "rejected"),
      idea("sel", 3, "selected"),
      idea("c", 5, "proposed"),
      idea("b", 4, "proposed"),
    ];
    expect(nextBestIdea(ideas, ctx)).toBe("b");
  });

  it("null when nothing can arrive in time", () => {
    expect(nextBestIdea([idea("slow", 1, "proposed", 30), idea("rej", 2, "rejected")], ctx)).toBeNull();
    expect(nextBestIdea([], ctx)).toBeNull();
  });
});

describe("picksBar", () => {
  it("2 picks of $30 against $50 at 20% are over; against $70 within; 3 of $30 dropped", () => {
    expect(picksBar([3000, 3000], 5000, 20)).toEqual({ count: 2, totalCents: 6000, fit: "over" });
    expect(picksBar([3000, 3000], 7000, 20)).toEqual({ count: 2, totalCents: 6000, fit: "within" });
    expect(picksBar([3000, 3000, 3000], 5000, 20)).toEqual({ count: 3, totalCents: 9000, fit: "dropped" });
  });
});

describe("ideaBlock", () => {
  it.each([
    [{}, null],
    [{ claimedByMe: true }, "own_order"],
    [{ claimed: true, claimedByMe: true }, "claimed"],
    [{ noLongerShared: true, claimed: true }, "not_shared"],
  ])("%o is %s", (over, block) => {
    expect(ideaBlock({ noLongerShared: false, claimed: false, claimedByMe: false, ...over })).toBe(block);
  });
});
