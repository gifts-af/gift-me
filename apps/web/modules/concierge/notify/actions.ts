// The things a one-time email link can do (ALL-23). Each action brings its own
// words for the confirm page and the result page, and the work it does once the
// owner presses confirm. Real actions (ALL-28 and later) add entries here.
import type { NotifyStore } from "./store";

export type ActionName = "test" | "open_person";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type Action = {
  confirm: { title: string; body: string; button: string };
  done: { title: string; body: string };
  run(ctx: { userId: string; roundId: string | null }): Promise<ActionResult>;
  /** Where the done page's button goes instead of home, when the action knows (e.g. "/people/<id>"). */
  next?(roundId: string | null, store: NotifyStore): Promise<string | null>;
};

export const ACTIONS: Record<ActionName, Action> = {
  // The Settings test email's button: proves the whole path and does nothing else.
  test: {
    confirm: {
      title: "Try the test button",
      body: "This is how buttons in our emails work: you confirm here, then it's done.",
      button: "Try it",
    },
    done: {
      title: "Done",
      body: "It works. Buttons in our emails will look like this.",
    },
    async run() {
      return { ok: true };
    },
  },

  // The "Open GiftsAF" buttons in round emails (ALL-28): confirming does nothing
  // but let the done page link to the round's person. The words are static, so
  // they can't name the person.
  open_person: {
    confirm: {
      title: "Open their page",
      body: "Confirm to open this person's page.",
      button: "Open their page",
    },
    done: {
      title: "Done",
      body: "You're all set. Open their page to pick up where you left off.",
    },
    async run() {
      return { ok: true };
    },
    async next(roundId, store) {
      const personId = roundId ? await store.roundPersonId(roundId) : null;
      return personId ? `/people/${personId}` : null;
    },
  },
};
