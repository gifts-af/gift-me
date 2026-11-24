// Pure rules for how a gift went over: the four answers, and what each one
// teaches the person's profile. No I/O.
import { cut, FACT_VALUE_MAX } from "./approval";

/** Best first, the order they're offered in. */
export const RATINGS = ["loved", "liked", "meh", "returned"] as const;
export type Rating = (typeof RATINGS)[number];

export const RATING_LABELS: Record<Rating, string> = {
  loved: "Loved it",
  liked: "Liked it",
  meh: "Meh",
  returned: "Returned it",
};

export type ReactionFact = { category: "loved" | "avoid"; value: string };

/**
 * What an answer saves to the person's profile, or null. "Liked it" is too weak to steer ideas,
 * and "Returned it" without a note isn't dislike (wrong size, broken). A gift from someone's list
 * never becomes a fact: that person's words stay out of facts and the AI (T42).
 */
export function reactionFact(
  rating: Rating,
  gift: { title: string; fromList: boolean },
  note: string | null,
): ReactionFact | null {
  const title = gift.title.trim();
  if (gift.fromList || !title) return null;
  const reason = note?.trim() ?? "";
  const named = reason ? `${title}: ${reason}` : title;
  const value = (s: string) => cut(s, FACT_VALUE_MAX).trim();
  if (rating === "loved") return { category: "loved", value: value(named) };
  if (rating === "meh") return { category: "avoid", value: value(`Didn't love: ${named}`) };
  if (rating === "returned" && reason) return { category: "avoid", value: value(`Returned ${named}`) };
  return null;
}
