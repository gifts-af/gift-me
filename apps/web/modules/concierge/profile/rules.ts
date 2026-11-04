import { CATEGORY_GROUPS, GUIDED_QUESTIONS, splitAnswer, type FactCategory, type QuestionKey } from "@gifts-af/core";
import { isSensitive } from "@/lib/ai/sensitive";

// Checking what a buyer types on the profile screens (ALL-26). A form is refused
// whole before anything is saved, so one bad answer can't leave half a form behind.

/** C-8 and decision 51: typed text follows the same rule as what the AI reads. */
export const SENSITIVE_REFUSAL = "We don't keep notes about health, religion, politics or similar. Try wording it another way.";

export type Answer = { key: QuestionKey; prompt: string; category: FactCategory; values: string[] };
export type ParsedAnswers = { ok: true; answers: Answer[] } | { ok: false; error: string; key?: QuestionKey };

export function parseAnswers(fields: Record<string, string>, maxFacts: number): ParsedAnswers {
  const answers: Answer[] = [];
  for (const q of GUIDED_QUESTIONS) {
    const values = splitAnswer(fields[q.key] ?? "");
    if (values.length === 0) continue;
    if (values.length > maxFacts) {
      return { ok: false, key: q.key, error: `That's a lot for one answer. Keep it to ${maxFacts} things.` };
    }
    if (values.some(isSensitive)) return { ok: false, key: q.key, error: SENSITIVE_REFUSAL };
    answers.push({ key: q.key, prompt: q.prompt, category: q.category, values });
  }
  if (answers.length === 0) return { ok: false, error: "Answer at least one, or skip them." };
  return { ok: true, answers };
}

export type ParsedEdit = { ok: true; category: FactCategory; value: string } | { ok: false; error: string };

export function parseFactEdit(input: { category: string; value: string }): ParsedEdit {
  const category = CATEGORY_GROUPS.find((g) => g.category === input.category)?.category;
  if (!category) return { ok: false, error: "That didn't go through. Reload and try again." };
  const value = input.value.trim().replace(/\s+/g, " ");
  if (!value) return { ok: false, error: "Type something first." };
  if (isSensitive(value)) return { ok: false, error: SENSITIVE_REFUSAL };
  return { ok: true, category, value };
}
