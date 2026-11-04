import type { FactCategory } from "./facts";

// What a person's profile adds up to (ALL-26, C-4, C-6): which guided questions
// are open, how ready their ideas are, and the one next step. The numbers come
// from app_settings (T23); only the wording lives here.

export type QuestionKey = "interests" | "wants" | "avoid" | "sizes" | "brands" | "owns";

export type GuidedQuestion = {
  key: QuestionKey;
  /** No names, so the stored prompt holds no personal data and can't go stale. */
  prompt: string;
  hint: string;
  /** Where an answer is saved. */
  category: FactCategory;
  /** A fact in any of these fills the gap. */
  categories: readonly FactCategory[];
};

/** Most useful first: interests shape ideas the most. */
export const GUIDED_QUESTIONS: readonly GuidedQuestion[] = [
  {
    key: "interests",
    prompt: "What are they into right now?",
    hint: "Hobbies, teams, shows. Separate with commas.",
    category: "interest",
    categories: ["interest", "loved"],
  },
  {
    key: "wants",
    prompt: "Anything they've said they want or need?",
    hint: "Separate with commas.",
    category: "wants",
    categories: ["wants"],
  },
  {
    key: "avoid",
    prompt: "Anything to steer clear of with them?",
    hint: "Things they dislike or have no room for.",
    category: "avoid",
    categories: ["avoid", "dislike", "constraint"],
  },
  {
    key: "sizes",
    prompt: "What sizes do they wear?",
    hint: "For example: shirt L, shoe 10.5.",
    category: "size",
    categories: ["size"],
  },
  {
    key: "brands",
    prompt: "Any brands or stores they love?",
    hint: "Separate with commas.",
    category: "brand",
    categories: ["brand", "style"],
  },
  {
    key: "owns",
    prompt: "What do they already have plenty of?",
    hint: "So we don't suggest another one.",
    category: "owns",
    categories: ["owns"],
  },
];

/** Every category, in the order the person page shows them. */
export const CATEGORY_GROUPS: readonly { category: FactCategory; label: string }[] = [
  { category: "interest", label: "Interests" },
  { category: "wants", label: "Wants" },
  { category: "loved", label: "Loved" },
  { category: "size", label: "Sizes" },
  { category: "brand", label: "Brands" },
  { category: "style", label: "Style" },
  { category: "owns", label: "Already has" },
  { category: "dislike", label: "Dislikes" },
  { category: "avoid", label: "Avoid" },
  { category: "constraint", label: "Needs" },
];

/** Where a fact came from, in the buyer's words. Confirmed AI facts lose the ✨ (D47, D51). */
export function factSourceLabel(source: string, confirmed: boolean): string {
  switch (source) {
    case "capture":
      return confirmed ? "From a capture" : "✨ AI suggestion";
    case "question":
      return "You answered";
    case "reaction":
      return "From their reaction";
    case "rejection":
      return "From an idea you passed on";
    case "inbound":
      return "From your email";
    default:
      return "You told us";
  }
}

const filled = (q: GuidedQuestion, active: Set<FactCategory>) => q.categories.some((c) => active.has(c));

/** A gap with no active fact, not skipped (T53). `max` 0 switches questions off. */
export function openQuestions(
  active: Iterable<FactCategory>,
  skipped: Iterable<string>,
  max: number,
): GuidedQuestion[] {
  const have = new Set(active);
  const skip = new Set(skipped);
  return GUIDED_QUESTIONS.filter((q) => !filled(q, have) && !skip.has(q.key)).slice(0, Math.max(0, max));
}

/** One answer as separate facts: split on commas and new lines, tidied, repeats dropped. */
export function splitAnswer(text: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const value = part.trim().replace(/\s+/g, " ");
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }
  return values;
}

export type ReadinessSettings = { points: Record<QuestionKey, number>; ownList: number; readyPct: number };

/** Points for each filled gap, plus their own list (D37), capped at 100. */
export function readinessScore(
  active: Iterable<FactCategory>,
  keepsList: boolean,
  s: Pick<ReadinessSettings, "points" | "ownList">,
): number {
  const have = new Set(active);
  const earned = GUIDED_QUESTIONS.reduce((sum, q) => sum + (filled(q, have) ? s.points[q.key] : 0), 0);
  return Math.min(100, earned + (keepsList ? s.ownList : 0));
}

export type ReadinessLabel = "Just starting" | "Getting there" | "Good to go";

export function readinessLabel(score: number, readyPct: number): ReadinessLabel {
  if (score <= 0) return "Just starting";
  return score >= readyPct ? "Good to go" : "Getting there";
}

export type NextStep = { kind: "answer"; count: number } | { kind: "capture" } | { kind: "none" };

/** The one suggested next step (C-6). */
export function nextStep(openCount: number, score: number, readyPct: number): NextStep {
  if (openCount > 0) return { kind: "answer", count: openCount };
  return score < readyPct ? { kind: "capture" } : { kind: "none" };
}
