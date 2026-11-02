// @vitest-environment node
import { describe, expect, it } from "vitest";
import recordedText from "../fixtures/recorded/extract.json";
import { isSensitive } from "../sensitive";

// The four sensitive-trait traps in the W1-3 fixtures (design/spikes/ai.md):
// grief, health, religion and pregnancy.
const TRAPS = ["june-1", "june-2", "priya-1", "priya-2"];
const TRAP_WORDS = /arthritis|blood pressure|medication|\bmeds\b|pregnan|baby|diwali|temple|widow|late husband|grie/i;

describe("isSensitive", () => {
  it.each([
    "pregnant, due in May",
    "6 weeks pregnant",
    "goes to temple weekly",
    "celebrates Diwali",
    "takes blood pressure meds",
    "has arthritis in her hands",
    "on chemo",
    "votes Democrat",
    "gay",
    "grieving her husband",
    "widowed last year",
    "in debt",
    "recently laid off",
    // Found in review: other ways of saying the same things.
    "due in May",
    "expecting",
    "maternity clothes",
    "newborn on the way",
    "baby shower gifts",
    "insulin pump case",
    "wheelchair-friendly",
    "hearing aids",
    "uses a cane",
    "knee replacement",
    "physical therapy",
    "chronic pain",
    "lost her husband",
    "late mother",
    "memorial jewelry",
    "keeps kosher",
    "halal snacks",
    "wears a hijab",
    "rosary",
    "Rosh Hashanah",
    "Pride flag",
    "tight on money",
    "flat broke after the move",
  ])("blocks %j", (value) => {
    expect(isSensitive(value)).toBe(true);
  });

  it.each([
    "prefers easy-open, large-grip items",
    "wants a new wallet",
    "coffee: Onyx Coffee Lab",
    "needs a new rotary fly-tying vise",
    "running gear",
    "training for the Chicago Marathon",
    "Christmas ornaments",
    "owns baby monitor app",
    // Found in review: ordinary gift facts that share a word with a sensitive topic.
    "Brand: Christian Dior",
    "Christian Louboutin heels",
    "conservative, classic style",
    "death metal",
    "liberal arts books",
    "sober neutral colors",
    "praying mantis figurines",
    "his old vise broke",
    "candy cane ornaments",
  ])("allows %j", (value) => {
    expect(isSensitive(value)).toBe(false);
  });

  it("leaves no trap words in the recorded Sonnet facts once filtered", () => {
    const kept = recordedText.results
      .filter((r) => TRAPS.includes(r.capture))
      .flatMap((r) => r.facts)
      .filter((f) => !isSensitive(f.value));
    expect(kept.length).toBeGreaterThan(0);
    for (const fact of kept) expect(fact.value).not.toMatch(TRAP_WORDS);
  });
});
