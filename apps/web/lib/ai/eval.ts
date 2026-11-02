import type { CandidateFact } from "./extract";
import { isSensitive } from "./sensitive";

// The AC-1 fixture check (ALL-25): did extraction find what it should, and
// nothing it mustn't? Used by expected.test.ts (recorded run) and
// scripts/ai-eval.ts (live model).

export type MustFind = { category: string[]; keywords: string[] };
export type Expected = { mustFind: MustFind[]; mustNotFind: string[] };

/** What the app would keep: no sensitive facts, nothing under the confidence cut. */
export function keptForEval(facts: CandidateFact[], minConfidencePct: number): CandidateFact[] {
  return facts.filter((f) => !isSensitive(f.value) && f.confidence * 100 >= minConfidencePct);
}

export function matchesExpected(facts: CandidateFact[], expected: Expected): { missing: MustFind[]; forbidden: string[] } {
  const lower = facts.map((f) => ({ category: f.category as string, value: f.value.toLowerCase() }));
  const missing = expected.mustFind.filter(
    (m) => !lower.some((f) => m.category.includes(f.category) && m.keywords.every((k) => f.value.includes(k.toLowerCase()))),
  );
  const forbidden = facts
    .filter((f) => expected.mustNotFind.some((w) => f.value.toLowerCase().includes(w.toLowerCase())))
    .map((f) => f.value);
  return { missing, forbidden };
}
