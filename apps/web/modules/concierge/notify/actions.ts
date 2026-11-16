// The things a one-time email link can do (ALL-23). Each action brings its own
// words for the confirm page and the result page, and the work it does once the
// owner presses confirm. Real actions (ALL-28 and later) add entries here.
import type { Extract } from "@/lib/ai/extract";
import { errorFields, logEvent } from "@/lib/log";
import { processCapture } from "../capture/extract";
import type { CaptureStore } from "../capture/store";
import { looksLikeCancel } from "../inbound/parse";
import { sendInboundReply } from "../inbound/reply";
import type { InboundStore } from "../inbound/store";
import type { NotifyDeps } from "./notify";
import type { LinkRow, NotifyStore } from "./store";

export type ActionName =
  | "test"
  | "open_person"
  | "add_address"
  | "answer_questions"
  | "open_settings"
  | "check_my_address"
  | "cancel_held_gift"
  // ALL-31: a "Who is this about?" choice, filing an emailed note to that person.
  | "file_note";

/**
 * `done`: the done page's words when they depend on what happened (else the action's own).
 * `next`: where the done page's button goes when that depends on what happened too, overriding
 * the action's `next`; null means home.
 */
export type ActionResult =
  | { ok: true; done?: { title: string; body: string }; next?: string | null }
  | { ok: false; error: string };

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

/**
 * What file_note needs beyond the database (ALL-31): the capture store for the link's user (on
 * the service-role client), the model that reads it, and for the "can't cancel" email the
 * inbound daily cap (its count and inbound_max_per_user_per_day, read only when sending) and
 * notify. The confirm route passes a builder, called only when a file_note link runs; a caller
 * without one can't run file_note.
 */
export type NoteDeps = {
  captureStore(userId: string): CaptureStore;
  extract: Extract;
  inbound: Pick<InboundStore, "countToday" | "recordEvent" | "settings">;
  notify: NotifyDeps;
};

export type ActionCtx = {
  userId: string;
  roundId: string | null;
  personId: string | null;
  inboundMessageId: string | null;
  store: NotifyStore;
  /** Builds file_note's deps; only file_note calls it. */
  notes?: () => NoteDeps;
};

export type Action = {
  confirm: { title: string; body: string; button: string };
  /** The confirm page's words when they depend on the link (e.g. naming its person); else `confirm`. */
  confirmFor?(link: LinkRow, store: NotifyStore): Promise<Action["confirm"]>;
  done: { title: string; body: string };
  run(ctx: ActionCtx): Promise<ActionResult>;
  /** Where the done page's button goes instead of home, when the action knows (e.g. "/people/<id>"). */
  next?(link: Pick<LinkRow, "userId" | "roundId" | "personId">, store: NotifyStore): Promise<string | null>;
  /** Go to `next` right after confirming, with no done page in between. */
  straight?: true;
};

/** file_note's done pages when it didn't file (ALL-31 AC-4). */
const NOTE_ALREADY_FILED = {
  title: "Already filed",
  body: "This note was already added to someone's page, so nothing changed.",
};

const NOTE_PERSON_GONE = {
  title: "They were removed",
  body: "That person was removed, so the note wasn't filed. Use another button in the email, or add them again first.",
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
    async next({ roundId }, store) {
      // A removed person's page is gone: home (Give) instead (ALL-116, owner).
      const personId = roundId ? await store.roundPersonId(roundId, { skipRemoved: true }) : null;
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
    async next({ roundId }, store) {
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
    async next({ roundId }, store) {
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

  // The list owner's "Check my address" (ALL-112): no round, nothing about a gift.
  check_my_address: {
    confirm: {
      title: "Check your address",
      body: "Confirm to open your saved address.",
      button: "Open Settings",
    },
    done: {
      title: "Done",
      body: "Open Settings to check your saved address.",
    },
    async run() {
      return { ok: true };
    },
    async next() {
      return "/settings#my-address";
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
    async next({ roundId }, store) {
      const personId = roundId ? await store.roundPersonId(roundId) : null;
      return personId ? `/people/${personId}` : null;
    },
  },

  // A "Who is this about?" button (ALL-31 AC-4): files the asking note to the link's person and
  // reads it. file_inbound_message lets only the first button win; any later one says so.
  file_note: {
    confirm: { title: "File this note?", body: "Confirm to add your note to this person's page.", button: "File it" },
    async confirmFor(link, store) {
      const name = link.personId ? await store.personName(link.userId, link.personId) : null;
      // Removed since the email: the generic words; confirming says they were removed.
      if (!name) return ACTIONS.file_note.confirm;
      return {
        title: `File this note to ${name}?`,
        body: `We'll add it to ${name}'s page and read it for gift ideas.`,
        button: "File it",
      };
    },
    done: { title: "Filed", body: "Your note is on their page." },
    async run({ userId, personId, inboundMessageId, store, notes: buildNotes }) {
      if (!personId || !inboundMessageId) return { ok: false, error: "The link has no note or person." };
      if (!buildNotes) return { ok: false, error: "Filing a note needs the capture and notify deps." };
      const notes = buildNotes();
      // Neither result files to this person, so neither opens their page.
      const gone = { ok: true as const, done: NOTE_PERSON_GONE, next: null };
      if (!(await store.personName(userId, personId))) return gone;

      const ids = { user_id: userId, person_id: personId, inbound_message_id: inboundMessageId };
      const captureId = await store.fileInboundMessage(userId, inboundMessageId, personId);
      if (!captureId) {
        // Refused: deleted between the check and filing, or another button won.
        if (!(await store.personName(userId, personId))) return gone;
        return { ok: true, done: NOTE_ALREADY_FILED, next: null };
      }
      const filedIds = { ...ids, capture_id: captureId };
      logEvent("inbound.filed", { ...filedIds, matched_by: "choice" });

      // Filing cleared the message's subject and body; the capture holds them now.
      const captures = notes.captureStore(userId);
      let text: string;
      try {
        const capture = await captures.loadCapture(captureId);
        if (!capture) throw new Error("The filed capture is missing.");
        text = [capture.title, capture.text].filter(Boolean).join("\n");
      } catch (err) {
        // Filed, but not read: it stays pending for "Try again" on the person's page.
        logEvent("inbound.failed", { ...filedIds, ...errorFields(err) });
        return { ok: true };
      }

      try {
        await processCapture(captures, notes.extract, captureId);
      } catch (err) {
        // The capture stays filed and unread; "Try again" on the person's page reads it.
        logEvent("inbound.read_failed", { ...filedIds, ...errorFields(err) });
      }

      // AC-14 for a note that was asked about: filed, plus the "replies can't cancel" email,
      // under the same daily cap as the webhook's replies (AC-11).
      if (looksLikeCancel(text)) {
        try {
          const { maxPerDay } = await notes.inbound.settings();
          await sendInboundReply(
            { userId, kind: "notes_cant_cancel", data: {}, links: {} },
            { store: notes.inbound, maxPerDay, notify: notes.notify },
            filedIds,
          );
        } catch (err) {
          logEvent("inbound.reply_failed", { ...filedIds, kind: "notes_cant_cancel", ...errorFields(err) });
        }
      }
      return { ok: true };
    },
    async next({ userId, personId }, store) {
      // A removed person has no page: home instead.
      return personId && (await store.personName(userId, personId)) ? `/people/${personId}` : null;
    },
  },
};
