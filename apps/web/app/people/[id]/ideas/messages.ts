// What the Gift ideas screen says when a run brings back no ideas (ALL-27). Shared by
// suggestIdeasAction, which picks one, and the screen, which adds the questions link to NO_FACTS.

export const NO_FACTS = "Tell us a bit about them first.";

export const IDEA_MESSAGES = {
  none: "We couldn't find anything suitable this time.",
  busy: "Already looking. This takes about a minute.",
  off: "Suggestions are switched off right now.",
  failed: "Couldn't get ideas. Try again.",
  notFound: "This person is no longer on your list.",
} as const;
