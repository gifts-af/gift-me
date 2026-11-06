// The things a one-time email link can do (ALL-23). Each action brings its own
// words for the confirm page and the result page, and the work it does once the
// owner presses confirm. Real actions (ALL-28 and later) add entries here.
import type { NotifyStore } from "./store";

export type ActionName =
  | "test"
  | "open_person"
  | "add_address"
  | "answer_questions"
  | "open_settings"
  | "cancel_held_gift";

/** `done`: the done page's words when they depend on what happened (else the action's own). */
export type ActionResult = { ok: true; done?: { title: string; body: string } } | { ok: false; error: string };

/** What a cancel link did: held gifts it cancelled, and the round's others still being ordered or on their way. */
export type CancelOutcome = { cancelled: number; ordering: number; onItsWay: number };

/** The cancel link's done page, saying what actually happened (N2). */
export function cancelDone(o: CancelOutcome): { title: string; body: string } {
  const other = o.onItsWay > 0
    ? "Your other gift is already on its way and still arrives."
    : o.ordering > 0
      ? "Your other gift is already being ordered; we'll email you once the store confirms it."
      : "Nothing more will be bought for this occasion.";
  if (o.cancelled > 0) {
    const what = o.cancelled > 1 ? "the gifts that were waiting" : "the gift that was waiting";
    const charged = o.onItsWay + o.ordering > 0
      ? `nothing was charged for ${o.cancelled > 1 ? "them" : "it"}`
      : `nothing was bought or charged for ${o.cancelled > 1 ? "them" : "it"}`;
    return { title: "Cancelled", body: `We cancelled ${what}, so ${charged}. ${other}` };
  }
  if (o.ordering > 0) {
    return {
      title: "Already being ordered",
      body: "The gift was already being ordered, so there was nothing left to cancel. We'll email you once the store confirms it.",
    };
  }
  if (o.onItsWay > 0) {
    return { title: "Already on its way", body: "The gift was already ordered, so there was nothing left to cancel. It's on its way." };
  }
  return { title: "Nothing to cancel", body: "There was no gift waiting to be bought for this occasion." };
}

export type Action = {
  confirm: { title: string; body: string; button: string };
  done: { title: string; body: string };
  run(ctx: { userId: string; roundId: string | null; store: NotifyStore }): Promise<ActionResult>;
  /** Where the done page's button goes instead of home, when the action knows (e.g. "/people/<id>"). */
  next?(roundId: string | null, store: NotifyStore): Promise<string | null>;
  /** Go to `next` right after confirming, with no done page in between. */
  straight?: true;
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

  // The "Add an address" button in needs_address emails (ALL-81): like
  // open_person, but the done page opens the person's address form.
  add_address: {
    confirm: {
      title: "Add their address",
      body: "Confirm to open this person's page at their address.",
      button: "Add an address",
    },
    done: {
      title: "Done",
      body: "Open their page to add the address.",
    },
    async run() {
      return { ok: true };
    },
    async next(roundId, store) {
      const personId = roundId ? await store.roundPersonId(roundId) : null;
      return personId ? `/people/${personId}?address=open#address` : null;
    },
  },

  // The questions link in heads-up and reminder emails (ALL-26, design §6.7).
  answer_questions: {
    confirm: {
      title: "Answer a few questions",
      body: "Confirm to open the questions about this person.",
      button: "Answer the questions",
    },
    done: {
      title: "Done",
      body: "Open their page to answer the questions.",
    },
    async run() {
      return { ok: true };
    },
    async next(roundId, store) {
      const personId = roundId ? await store.roundPersonId(roundId) : null;
      return personId ? `/people/${personId}/questions` : null;
    },
    straight: true,
  },

  // "Finish setup" in the hold email for a gift waiting on payment setup (ALL-32).
  open_settings: {
    confirm: {
      title: "Finish setting up payment",
      body: "Confirm to open Settings, where you connect Zinc and add your phone.",
      button: "Open Settings",
    },
    done: {
      title: "Done",
      body: "Open Settings to finish setting up payment.",
    },
    async run() {
      return { ok: true };
    },
    async next() {
      return "/settings";
    },
    straight: true,
  },

  // "Cancel this gift" in the hold emails (ALL-32 AC-24): cancel_held cancels the held gifts
  // under the round row lock (not the engine's lease) and releases their list picks. A gift already
  // on its way isn't touched, and the round is never skipped while one is (T27).
  cancel_held_gift: {
    confirm: {
      title: "Cancel this gift",
      body: "Confirm to cancel the gift that's waiting to be bought. Nothing more will be bought for this occasion.",
      button: "Cancel the gift",
    },
    done: {
      title: "Cancelled",
      body: "Nothing more will be bought for this occasion. A gift that was already on its way still arrives.",
    },
    async run({ userId, roundId, store }) {
      if (!roundId) return { ok: false, error: "The link has no round." };
      const outcome = await store.cancelHeldGift(roundId, userId);
      return outcome ? { ok: true, done: cancelDone(outcome) } : { ok: false, error: "No such round for this user." };
    },
    async next(roundId, store) {
      const personId = roundId ? await store.roundPersonId(roundId) : null;
      return personId ? `/people/${personId}` : null;
    },
  },
};
