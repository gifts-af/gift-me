import { RATING_LABELS, RATINGS, type Rating } from "@gifts-af/core";
import { APP_NAME } from "@/lib/brand";
import { renderEmail } from "@/lib/email-layout";

export type NotificationKind =
  | "test"
  | "heads_up"
  | "reminder"
  | "final_notice"
  | "needs_attention"
  | "reaction_prompt"
  | "needs_address"
  | "skipped"
  // ALL-32: a gift held before buying, a failed order, and the deadline on our side.
  | "hold_funds"
  | "hold_setup"
  | "hold_address"
  | "hold_trouble"
  | "hold_unconfirmed"
  | "price_up"
  | "out_of_stock"
  | "too_late"
  | "missed_on_us"
  | "ordered"
  | "failed_late"
  // ALL-116: two or more of a round's gifts failed, told together.
  | "failed_several"
  // ALL-33: the store cancelled a bought gift, and it's too late to ship another in time.
  | "store_cancelled_late"
  // ALL-33: the daily tracking news. One gift late or back on time, or one summary of a buyer's news.
  | "gift_late"
  | "gift_on_time"
  | "tracking_news"
  // ALL-33: every gift of an occasion has arrived.
  | "delivered"
  // ALL-112: to a list owner, whose shared address a store couldn't use. Says nothing of a gift.
  | "check_your_address"
  // ALL-31: emailed notes. The tip, the "Who is this about?" question, and two one-off replies.
  | "notes_tip"
  | "who_is_this"
  | "notes_not_read"
  | "notes_cant_cancel"
  // ALL-27: a round couldn't get gift ideas (once, and `again` after the extra run).
  | "no_ideas";

/**
 * The kinds whose replies are notes, so they may carry the notes address as Reply-To. Only the
 * tip: a reply to a buying email ("don't buy it") must never become a note (ALL-31 AC-13, T18),
 * and a reply to "Who is this about?" would start a mail loop.
 */
export const REPLIES_ARE_NOTES = ["notes_tip"] as const satisfies readonly NotificationKind[];
export type NotesReplyKind = (typeof REPLIES_ARE_NOTES)[number];

export type RenderedEmail = { subject: string; html: string; text: string };

// Everything is already formatted by the caller (dates, prices).
// `arriveBy` is the date formatted; `store` the retailer's name; `reason` why we picked it.
export type IdeaRow = { title: string; price: string; overBudget?: boolean; arriveBy?: string; store?: string; reason?: string };

type Occasion = { personName: string; occasion: string; dateText: string };

/** How many guided questions are open for the person (ALL-26), when any are. */
type Asks = { questions?: number };

/** The heads-up's low-balance warning (AC-11): money already formatted, plus the Zinc wallet page. */
export type Funding = { dueText: string; haveText: string; atLeast: boolean; windowText: string; walletUrl: string };

/** The gifts the buyer chose, by title. */
type Gifts = Occasion & { giftTitles: string[] };
/** One gift, by title. */
type OneGift = Occasion & { giftTitle: string };
/**
 * A failed gift's siblings in its round, by title: `onItsWay`, placed or shipped; `ordering`, sent
 * to Zinc but not confirmed; `arrived`, delivered; `working`, held or unanswered, so it may or may
 * not be bought.
 */
export type OtherGifts = { onItsWay?: string[]; ordering?: string[]; arrived?: string[]; working?: string[] };
/** One failed gift while the round is open; `orderByText`: the last day to choose again in time. */
type Failure = OneGift & OtherGifts & { orderByText: string };
/** A failed gift in a summary (ALL-116): what happened, and the link text for what to do now. */
// `url` is that gift's own fix page (ALL-29).
/** `refunded`: the store cancelled it after it was bought, and the money is back in the Zinc wallet (ALL-33). */
export type FailedGift = { title: string; detail: string; action?: string; url: string; refunded?: boolean };
/** A gift the store cancelled after it was bought (ALL-33). */
export type CancelledGift = { title: string; store?: string; amountText?: string };

/**
 * One gift's news in the daily summary (ALL-33). `expectedText`: when it's now expected;
 * `url`: the round screen, only for a shipped late gift ("It already arrived").
 */
export type NewsItem = Occasion & { title: string } & (
    | { kind: "late"; expectedText: string; daysLate: number; url?: string }
    | { kind: "cancelled"; amountText?: string }
    | { kind: "on_time"; expectedText: string }
  );

export type TemplateData = {
  test: Record<string, never>;
  heads_up:
    /** `allFromList`: every gift is from their own list, so the subject may say so. */
    | (Occasion & Asks & { mode: "reminder"; ideas: IdeaRow[]; allFromList?: boolean; late?: boolean; funding?: Funding })
    | (Occasion & Asks & {
        mode: "auto_buy";
        ideas: IdeaRow[];
        autoBuyIdea: string;
        autoBuyDate: string;
        late?: boolean;
        funding?: Funding;
      });
  reminder: Occasion & Asks & { ideas: IdeaRow[] };
  final_notice: Occasion & { ideas: IdeaRow[]; orderByText: string };
  /** `orderByText`: when the buyer can still choose again; absent once there's nothing to choose. */
  needs_attention: Occasion & OtherGifts & { reason: string; orderByText?: string };
  /** Each occasion's delivered gifts without an answer. */
  reaction_prompt: { rounds: (Occasion & { gifts: { title: string }[] })[] };
  needs_address: Occasion & { reminder?: boolean };
  /**
   * `held`: the buyer chose a gift, but it couldn't be bought before the deadline. `partial`:
   * some of the chosen gifts were cancelled at the deadline while others are on their way.
   */
  skipped: Occasion & { held?: boolean; partial?: { cancelled: string[]; onItsWay: string[] } };
  hold_funds: Gifts & {
    neededText: string;
    /** The balance and shortfall, when the balance is known. */
    haveText?: string;
    shortText?: string;
    feeText: string;
    walletUrl: string;
    /** A gift of the same round already on its way. */
    placedTitle?: string;
    /** After a partial top-up (AC-22). */
    still?: boolean;
  };
  hold_setup: Gifts & { feeText: string };
  hold_address: Gifts & { feeText: string };
  hold_trouble: Gifts & { feeText: string };
  hold_unconfirmed: Gifts;
  price_up: Failure;
  out_of_stock: Failure;
  too_late: Failure;
  missed_on_us: Gifts;
  /** City only, never the full address. */
  ordered: OneGift & { cityText?: string };
  /**
   * Gifts that failed once their round closed, or untold when it closed (too late to choose
   * again), with why when known; `onItsWay`: the round's other gifts placed.
   */
  failed_late: Occasion & {
    failed: { title: string; detail?: string }[];
    onItsWay?: string[];
    /** Closed before its ship-by day (the cancel link, the occasion off, the person removed). */
    closedEarly?: boolean;
    /** The person was removed, so the button opens GiftsAF, not their page. */
    personRemoved?: boolean;
  };
  /** ALL-116: `tried`, how many gifts were ordered in the round. */
  failed_several: Occasion & OtherGifts & { tried: number; failed: FailedGift[]; orderByText: string };
  /**
   * ALL-33: gifts the store cancelled after they were bought, too late to ship another. `store`
   * and `amountText` (the refund) are left out when unknown, never guessed.
   */
  store_cancelled_late: Occasion & { gifts: CancelledGift[] };
  /** ALL-33: one gift now expected after the occasion; `daysLate`, how many days after. */
  gift_late: OneGift & { expectedText: string; daysLate: number };
  /** ALL-33: a gift told late is expected on or before the occasion again. */
  gift_on_time: OneGift & { expectedText: string };
  /** ALL-33: two or more gifts' news, across the buyer's people and occasions, in the order told. */
  tracking_news: { items: NewsItem[] };
  /** ALL-33: every gift of the round arrived; `deliveredText` is each gift's delivered date, formatted, left out when unknown. */
  delivered: Occasion & { gifts: { title: string; deliveredText?: string }[] };
  check_your_address: Record<string, never>;
  notes_tip: { personName: string };
  /** `subject`: the note's subject line, empty when it had none; `choices`: one link each, in order. */
  who_is_this: { subject: string; choices: { name: string }[] };
  notes_not_read: Record<string, never>;
  notes_cant_cancel: Record<string, never>;
  /** `again`: the extra run a new fact allowed found nothing too. */
  no_ideas: { personName: string; again: boolean };
};

export type TemplateLinks = {
  test: { tryIt: string };
  // `skip`, when given, is shown as a plain link to copy; the button stays the only anchor.
  // `buy{i}` is the "Buy this" link of ideas[i] (the who_is_this pattern); `choose` opens the round screen (ALL-29).
  heads_up: { choose: string; skip?: string; questions?: string; [buy: `buy${number}`]: string };
  reminder: { choose: string; questions?: string; [buy: `buy${number}`]: string };
  final_notice: { choose: string; [buy: `buy${number}`]: string };
  needs_attention: { open: string };
  // `{rating}{i}` opens the answer page with that answer chosen for the i-th gift across the rounds.
  reaction_prompt: { [answer: `${Rating}${number}`]: string };
  needs_address: { addAddress: string };
  skipped: { open: string };
  hold_funds: { cancel: string };
  hold_setup: { setup: string; cancel: string };
  hold_address: { addAddress: string; cancel: string };
  hold_trouble: { open: string; cancel: string };
  hold_unconfirmed: { open: string };
  price_up: { open: string };
  out_of_stock: { open: string };
  too_late: { open: string };
  missed_on_us: { open: string };
  ordered: { open: string };
  failed_late: { open: string };
  // `open` is the person's page; each failed gift carries its own fix page in `FailedGift.url`.
  failed_several: { open: string };
  // Nothing more can ship in time, so there's nothing to tap.
  store_cancelled_late: Record<string, never>;
  // `arrived` opens the round screen, only for a shipped gift (a placed one can't be marked arrived).
  gift_late: { arrived?: string };
  gift_on_time: { open: string };
  // Each shipped late gift carries its own round screen link in `NewsItem.url`.
  tracking_news: Record<string, never>;
  delivered: { open: string };
  check_your_address: { open: string };
  notes_tip: Record<string, never>;
  // `choice{i}` files the note to `choices[i]`; `someoneElse` is the plain people page.
  who_is_this: { [choice: `choice${number}`]: string; someoneElse: string };
  notes_not_read: Record<string, never>;
  notes_cant_cancel: Record<string, never>;
  no_ideas: { questions: string };
};

/** A gift's answer link. Missing, it would render href="undefined": refuse rather than send that. */
function answerLink(links: TemplateLinks["reaction_prompt"], rating: Rating, i: number): string {
  const url = links[`${rating}${i}`];
  if (!url) throw new Error(`No link for answer ${rating}${i}`);
  return url;
}

/** An idea's "Buy this" link. Missing, it would render href="undefined": refuse rather than send that. */
function buyLink(links: Record<string, string | undefined>, i: number): string {
  const url = links[`buy${i}`];
  if (!url) throw new Error(`No link for idea buy${i}`);
  return url;
}

/** Idea rows; with `links`, each gets its own "Buy this" link (ALL-29 AC-1). */
const rowsOf = (ideas: IdeaRow[], links?: Record<string, string | undefined>) =>
  ideas.map((i, n) => {
    const detail = [i.overBudget ? "Over budget" : "", i.arriveBy ? `Arrives by ${i.arriveBy}` : "", i.store ?? ""].filter(Boolean).join(" · ");
    return {
      title: `${i.title} · ${i.price}`,
      ...(detail ? { detail } : {}),
      ...(i.reason ? { reason: i.reason } : {}),
      ...(links ? { link: { label: "Buy this ›", url: buyLink(links, n) } } : {}),
    };
  });

const PICK_BUTTON = "Pick several or none of these";

const PRICES_NOTE = "Prices include shipping and tax.";

// Bad news is told with an apology, what it means for the buyer, what was charged, and what
// happens next (owner, 2026-11-08, ALL-116).
const NEXT_TIME = (name: string) => `You can still pick something up yourself. We'll be in touch before ${name}'s next occasion.`;

function skippedEmail(d: TemplateData["skipped"], links: TemplateLinks["skipped"]): RenderedEmail {
  if (d.held) {
    return {
      subject: `Sorry, we couldn't buy ${d.personName}'s gift in time`,
      ...renderEmail({
        heading: `We're sorry, ${d.personName}'s gift couldn't be bought in time`,
        paragraphs: [
          `We're sorry. The gift you chose for ${d.personName}'s ${d.occasion} on ${d.dateText} couldn't be bought in time, so we didn't buy it and you haven't been charged.`,
        ],
        button: { label: `Open ${d.personName}'s page`, url: links.open },
        footer: `What happens next: ${NEXT_TIME(d.personName)}`,
      }),
    };
  }
  // Not bad news on our side: nobody chose a gift. Plain, never blaming.
  return {
    subject: `No gift for ${d.personName}'s ${d.occasion} this time`,
    ...renderEmail({
      heading: `No gift for ${d.personName}'s ${d.occasion} this time`,
      paragraphs: [
        `No gift was chosen for ${d.personName}'s ${d.occasion} on ${d.dateText}, so we didn't buy anything and you haven't been charged.`,
      ],
      button: { label: `Open ${d.personName}'s page`, url: links.open },
      footer: `What happens next: ${NEXT_TIME(d.personName)}`,
    }),
  };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "the Mug", "the Mug and the Apron", "the Mug, the Apron and the Vase". */
function giftList(titles: string[]): string {
  const named = titles.map((t) => `the ${t}`);
  return named.length <= 1 ? (named[0] ?? "the gift") : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/** "one", "two" ... "nine", then digits: how the late emails count days and gifts. */
function countWord(n: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][n] ?? String(n);
}

/** "their birthday", "Christmas": a holiday is named, a birthday or anniversary is theirs. */
const theirDay = (occasion: string) => (/^[a-z]/.test(occasion) ? `their ${occasion}` : occasion);

const daysLateText = (n: number) => `${countWord(n)} ${n === 1 ? "day" : "days"} late`;

function newsRow(i: NewsItem): { title: string; detail: string; link?: { label: string; url: string } } {
  const forDay = `For ${i.personName}'s ${i.occasion} on ${i.dateText}.`;
  switch (i.kind) {
    case "late":
      return {
        title: `${i.title} may arrive late`,
        detail: `${forDay} Now expected ${i.expectedText}, ${daysLateText(i.daysLate)}. It's on its way and can't be cancelled.`,
        ...(i.url ? { link: { label: "It already arrived", url: i.url } } : {}),
      };
    case "cancelled":
      return {
        title: `The store cancelled the ${i.title}`,
        detail: `${forDay} The ${i.amountText ?? "money"} is back in your Zinc wallet. It's too late to ship another in time.`,
      };
    case "on_time":
      return { title: `Good news: the ${i.title} is back on time`, detail: `${forDay} Now expected ${i.expectedText}.` };
  }
}

/** What the buyer can do, for the kinds of bad news in the summary. */
function newsFooter(late: boolean, cancelled: boolean): string | undefined {
  if (late && cancelled) {
    return "What you can do for a late or cancelled gift: keep a late one (nothing to do), or get something locally for the day and return the late one once it arrives. Nothing more is bought for these occasions.";
  }
  if (late) {
    return "What you can do for a late gift: keep it (nothing to do), or get something locally for the day and return the late one once it arrives. We keep watching them, and we'll let you know if one is back on time.";
  }
  if (cancelled) {
    return "What you can do for a cancelled gift: get something locally for the day, or order something yourself from any store and send it a little late. Nothing more is bought for these occasions.";
  }
  return undefined;
}

const itOrThem = (titles: string[]) => (titles.length > 1 ? "them" : "it");

/** "The Mug is ordered and on its way.", for the round's gifts already placed; nothing when none. */
function onItsWayLine(titles: string[] | undefined, lead = ""): string[] {
  if (!titles || titles.length === 0) return [];
  const list = giftList(titles);
  const sentence = `${titles.length > 1 ? `${list} are` : `${list} is`} ordered and on ${titles.length > 1 ? "their" : "its"} way.`;
  return [lead ? `${lead}${sentence}` : capitalize(sentence)];
}

/** The good news in a failure email: the round's other gifts that were ordered; nothing when none. */
function alsoOrderedLines({ onItsWay, ordering, arrived }: OtherGifts): string[] {
  const lines = onItsWayLine(onItsWay);
  if (ordering?.length) {
    lines.push(`We're ordering ${giftList(ordering)}, and we'll email you as soon as the store confirms ${itOrThem(ordering)}.`);
  }
  if (arrived?.length) lines.push(capitalize(`${giftList(arrived)} ${arrived.length > 1 ? "have" : "has"} arrived.`));
  return lines.map((l, i) => (i === 0 ? `The good news: ${l.charAt(0).toLowerCase()}${l.slice(1)}` : l));
}

/** What else is bought, in a failure email: no promise while another gift may still be. */
function elseBought(d: OtherGifts): string {
  if (d.working?.length) return `We're still working on ${giftList(d.working)}.`;
  return d.onItsWay?.length || d.ordering?.length || d.arrived?.length
    ? "Nothing else is bought until you choose."
    : "Nothing is bought until you choose.";
}

/**
 * Why a gift for a list owner's shared address ended (ALL-112), for the needs_attention email.
 * `ownerAsked`: the owner has been or will be asked to check it, so the buyer can be told so.
 */
export function endedAddressReason(
  type: "address_withdrawn" | "address_rejected",
  personName: string,
  titles: string[],
  ownerAsked: boolean,
): string {
  const what = `so we didn't buy ${giftList(titles)} and you haven't been charged for ${itOrThem(titles)}.`;
  if (type === "address_withdrawn") return `we can't use the address ${personName} was sharing, ${what}`;
  const ended = `the store couldn't use the address ${personName} saved, ${what}`;
  return ownerAsked ? `${ended} We'll ask ${personName} to check it, without mentioning a gift.` : ended;
}

/**
 * Every hold email ends the same way (owner): what it will cost once it's sorted, said plainly
 * (ALL-114, folded into ALL-116), and how to back out.
 */
function holdEnd(cancel: string, cost: string) {
  return { tip: cost, cancel: { before: "Changed your mind?", label: "Cancel this gift", url: cancel } };
}

const costOnceSorted = (feeText: string) => `Once it's sorted, we'll buy the gift: its price plus Zinc's ${feeText} fee.`;

/** The low-balance box and top-up link of the heads-up (AC-11). */
function fundingParts(f: Funding | undefined) {
  if (!f) return {};
  return {
    warning: {
      lead: "Your Zinc balance is low.",
      text: `${f.atLeast ? "At least " : ""}${f.dueText} in gifts are due in ${f.windowText}, and you have ${f.haveText}. Add funds or turn on auto top-up in Zinc so nothing waits.`,
    },
    topUp: { label: "Top up your Zinc balance", url: f.walletUrl },
  };
}

/** The plain link to the guided questions (design §6.7), when there are any. */
function questionsLink(d: Occasion & Asks, url: string | undefined): { label: string; url: string } | undefined {
  if (!d.questions || !url) return undefined;
  return { label: `Answer ${d.questions} quick ${d.questions === 1 ? "question" : "questions"} about ${d.personName}`, url };
}

/** A who_is_this choice's link. Missing, it would render href="undefined": refuse rather than send that. */
function choiceLink(links: TemplateLinks["who_is_this"], i: number): string {
  const url = links[`choice${i}`];
  if (!url) throw new Error(`who_is_this: no link for choice ${i}`);
  return url;
}

export const TEMPLATES: {
  [K in NotificationKind]: (data: TemplateData[K], links: TemplateLinks[K]) => RenderedEmail;
} = {
  test: (_data, links) => ({
    subject: `Your test email from ${APP_NAME}`,
    ...renderEmail({
      heading: `Your test email from ${APP_NAME}`,
      paragraphs: ["Good news: email works. This is how we'll reach you about gifts."],
      button: { label: "Try the button", url: links.tryIt },
    }),
  }),

  heads_up: (d, links) => {
    const funding = fundingParts(d.funding);
    const plainLinks = (questions: ReturnType<typeof questionsLink>) =>
      [funding.topUp, questions].filter((l): l is { label: string; url: string } => l !== undefined);
    const late = d.late
      ? [`${d.personName}'s ${d.occasion} is close, so we've kept only gifts that can still arrive in time.`]
      : [];
    if (d.mode === "auto_buy") {
      return {
        subject: `We'll buy ${d.personName}'s gift on ${d.autoBuyDate}`,
        ...renderEmail({
          heading: `Auto-buy is on for ${d.personName}`,
          paragraphs: [
            `${d.personName}'s ${d.occasion} is ${d.dateText}. On ${d.autoBuyDate} we'll buy ${d.autoBuyIdea} and ship it to ${d.personName}, unless you choose something else first.`,
            ...late,
          ],
          rows: rowsOf(d.ideas),
          warning: funding.warning,
          button: { label: "Review or change", url: links.choose },
          link: plainLinks(questionsLink(d, links.questions)),
          footer:
            `To skip this gift, open the link and choose "Don't buy". You can turn auto-buy off for ${d.personName} in their profile. ${PRICES_NOTE}` +
            (links.skip ? ` Or skip directly: ${links.skip}` : ""),
        }),
      };
    }
    const n = d.ideas.length;
    const what = d.allFromList ? `${n === 1 ? "gift" : "gifts"} from their list` : n === 1 ? "gift idea" : "gift ideas";
    return {
      subject: `${d.personName}'s ${d.occasion}: ${n} ${what}`,
      ...renderEmail({
        heading: `${d.personName}'s ${d.occasion} is coming up`,
        paragraphs: [
          `${d.personName}'s ${d.occasion} is ${d.dateText}. These gifts can still arrive in time.`,
          ...late,
        ],
        rows: rowsOf(d.ideas, links),
        warning: funding.warning,
        button: { label: PICK_BUTTON, url: links.choose },
        link: plainLinks(questionsLink(d, links.questions)),
        footer: `Nothing is bought until you choose. ${PRICES_NOTE}`,
      }),
    };
  },

  reminder: (d, links) => ({
    subject: `Reminder: ${d.personName}'s ${d.occasion} is ${d.dateText}`,
    ...renderEmail({
      heading: `Still time to pick a gift for ${d.personName}`,
      paragraphs: [
        `${d.personName}'s ${d.occasion} is ${d.dateText} and you haven't chosen a gift yet.`,
        "Pick one and we'll take care of the rest.",
      ],
      rows: rowsOf(d.ideas, links),
      button: { label: PICK_BUTTON, url: links.choose },
      link: questionsLink(d, links.questions),
      footer: `Nothing is bought until you choose. ${PRICES_NOTE}`,
    }),
  }),

  final_notice: (d, links) => ({
    subject: `Last chance: ${d.personName}'s ${d.occasion} gift`,
    ...renderEmail({
      heading: `Last chance to choose a gift for ${d.personName}`,
      paragraphs: [
        `${d.personName}'s ${d.occasion} is ${d.dateText}. Choose a gift by ${d.orderByText} so it arrives in time.`,
        "Choose one now so it gets there.",
      ],
      rows: rowsOf(d.ideas, links),
      button: { label: PICK_BUTTON, url: links.choose },
      footer: `Nothing is bought until you choose. ${PRICES_NOTE}`,
    }),
  }),

  needs_attention: (d, links) => ({
    subject: `Sorry, there's a problem with ${d.personName}'s gift`,
    ...renderEmail({
      heading: `Sorry, there's a problem with ${d.personName}'s gift`,
      paragraphs: [
        `We're sorry. We couldn't finish the gift for ${d.personName}'s ${d.occasion} on ${d.dateText}: ${d.reason}`,
        ...alsoOrderedLines(d),
      ],
      button: { label: "Review the gift", url: links.open },
      footer: d.orderByText
        ? `What happens next: ${d.working?.length ? `we're still working on ${giftList(d.working)}` : "nothing else is bought until you choose"}. Choose another gift by ${d.orderByText} so it arrives in time.`
        : `What happens next: ${NEXT_TIME(d.personName)}`,
    }),
  }),

  // One occasion's gifts, or one email for several (the caller orders them).
  reaction_prompt: (d, links) => {
    const gifts = d.rounds.flatMap((r) => r.gifts.map((g) => ({ title: g.title, whose: `${r.personName}'s ${r.occasion}, ${r.dateText}` })));
    const one = d.rounds.length === 1 ? d.rounds[0] : null;
    const noun = gifts.length === 1 ? "gift" : "gifts";
    const subject = one ? `How did ${one.personName} like the ${noun}?` : "How did your gifts go over?";
    const which = one ? `the ${noun} for ${one.personName}'s ${one.occasion} on ${one.dateText}` : "these gifts";
    return {
      subject,
      ...renderEmail({
        heading: subject,
        paragraphs: [`Tell us how ${which} went over. It helps us choose next time. Tap an answer, then tap Save on the page that opens.`],
        rows: gifts.map((g, i) => ({
          title: g.title,
          ...(one ? {} : { detail: g.whose }),
          links: RATINGS.map((r) => ({ label: RATING_LABELS[r], url: answerLink(links, r, i) })),
        })),
        footer: "You can skip any gift. Nothing is saved until you tap Save.",
      }),
    };
  },

  needs_address: (d, links) => ({
    subject: `We need ${d.personName}'s address`,
    ...renderEmail({
      heading: `Where should we send ${d.personName}'s gift?`,
      paragraphs: [
        `${d.personName}'s ${d.occasion} is ${d.dateText}, and we don't have an address for them yet.`,
        "Add one so the gift can arrive in time.",
        ...(d.reminder
          ? [`A reminder: we still need ${d.personName}'s address to find gifts that arrive by ${d.dateText}.`]
          : []),
      ],
      button: { label: "Add an address", url: links.addAddress },
    }),
  }),

  skipped: (d, links) =>
    d.partial
      ? {
          subject: `Sorry, we couldn't buy all of ${d.personName}'s gifts in time`,
          ...renderEmail({
            heading: `Sorry, we had to cancel ${d.partial.cancelled.length > 1 ? "some" : "one"} of ${d.personName}'s gifts`,
            paragraphs: [
              `We're sorry. We couldn't buy ${giftList(d.partial.cancelled)} for ${d.personName}'s ${d.occasion} in time, so we cancelled ${itOrThem(d.partial.cancelled)}. You haven't been charged for ${itOrThem(d.partial.cancelled)}.`,
              ...onItsWayLine(d.partial.onItsWay, "The good news: "),
            ],
            button: { label: `Open ${d.personName}'s page`, url: links.open },
            footer: `What happens next: you can still pick something up yourself in ${d.partial.cancelled.length > 1 ? "their" : "its"} place.`,
          }),
        }
      : skippedEmail(d, links),

  // ─── ALL-32: approved mock-ups, design/mockups/ALL-32-emails.html and ALL-32-emails-2.html ───

  hold_funds: (d, links) => {
    const end = holdEnd(links.cancel, `Topping up means we'll buy the gift: its price plus Zinc's ${d.feeText} fee.`);
    return {
      subject: d.still && d.shortText
        ? `You're still ${d.shortText} short for ${d.personName}'s gift`
        : `Sorry, ${d.personName}'s gift is waiting on your Zinc balance`,
      ...renderEmail({
        heading: `Sorry, we couldn't buy ${d.personName}'s gift yet`,
        paragraphs: [
          `Sorry for the hold-up. You chose ${giftList(d.giftTitles)} for ${d.personName}'s ${d.occasion} on ${d.dateText}, and there isn't enough in your Zinc balance to buy ${itOrThem(d.giftTitles)} yet. You haven't been charged.` +
            (d.placedTitle ? ` The ${d.placedTitle} is on its way.` : ""),
          `Zinc needs ${d.neededText} (the gift with room for a small price change, plus Zinc's ${d.feeText} fee).` +
            (d.haveText && d.shortText ? ` You have ${d.haveText}, so you're ${d.still ? "still " : ""}${d.shortText} short.` : ""),
          "What happens next: add funds in Zinc and we'll buy it as soon as we see them, usually within a day. There's no need to come back.",
        ],
        button: { label: "Top up your Zinc balance", url: d.walletUrl },
        // Its own line: a long sentence in front of the link would wrap around the tall tap target.
        tip: `${end.tip} To avoid this next time, turn on auto top-up in Zinc.`,
        link: end.cancel,
      }),
    };
  },

  hold_setup: (d, links) => {
    const end = holdEnd(links.cancel, costOnceSorted(d.feeText));
    return {
      subject: `Finish setting up payment to send ${d.personName}'s gift`,
      ...renderEmail({
        heading: `Sorry, we couldn't buy ${d.personName}'s gift yet`,
        paragraphs: [
          `Sorry for the hold-up. You chose ${giftList(d.giftTitles)} for ${d.personName}'s ${d.occasion} on ${d.dateText}, but payment isn't set up yet, so we couldn't buy ${itOrThem(d.giftTitles)}. You haven't been charged.`,
          `What happens next: gifts are paid from your own Zinc balance. Connect Zinc and add your phone in Settings. It takes about a minute, and once it's connected and funded, we'll buy ${itOrThem(d.giftTitles)}.`,
        ],
        button: { label: "Finish setup", url: links.setup },
        tip: end.tip,
        link: end.cancel,
      }),
    };
  },

  hold_address: (d, links) => {
    const end = holdEnd(links.cancel, costOnceSorted(d.feeText));
    return {
      subject: `Sorry, ${d.personName}'s gift needs an address`,
      ...renderEmail({
        heading: `Sorry, ${d.personName}'s gift needs an address`,
        paragraphs: [
          `Sorry for the hold-up. You chose ${giftList(d.giftTitles)} for ${d.personName}'s ${d.occasion} on ${d.dateText}, but we don't have an address we can ship to, so we haven't bought ${itOrThem(d.giftTitles)} yet. You haven't been charged.`,
          "What happens next: add or fix the address and we'll send the gift straight away. There's nothing else to do.",
        ],
        button: { label: "Fix the address", url: links.addAddress },
        tip: end.tip,
        link: end.cancel,
      }),
    };
  },

  hold_trouble: (d, links) => {
    const end = holdEnd(links.cancel, costOnceSorted(d.feeText));
    return {
      subject: `Sorry, we're having trouble ordering ${d.personName}'s gift`,
      ...renderEmail({
        heading: `Sorry, we're still trying to order ${d.personName}'s gift`,
        paragraphs: [
          `We're sorry for the wait. Our ordering service has been having trouble since you chose ${giftList(d.giftTitles)} for ${d.personName}'s ${d.occasion} on ${d.dateText}. You haven't been charged.`,
          "What happens next: we'll keep trying and email you as soon as it's placed. If you'd rather not wait, you can cancel it or choose another gift.",
        ],
        button: { label: `Open ${d.personName}'s page`, url: links.open },
        tip: end.tip,
        link: end.cancel,
      }),
    };
  },

  hold_unconfirmed: (d, links) => ({
    subject: `We're confirming ${d.personName}'s gift with the store`,
    ...renderEmail({
      heading: `Confirming ${d.personName}'s gift`,
      paragraphs: [
        `Sorry for the wait. We sent the order for ${giftList(d.giftTitles)} for ${d.personName}'s ${d.occasion} on ${d.dateText}, but haven't had confirmation from the store yet.`,
        "What happens next: we're checking on it now, and we'll email you as soon as we know. You won't be charged twice.",
      ],
      button: { label: `Open ${d.personName}'s page`, url: links.open },
    }),
  }),

  price_up: (d, links) => ({
    subject: `Sorry, the price of ${d.personName}'s gift went up`,
    ...renderEmail({
      heading: `Sorry, ${d.personName}'s gift went up in price`,
      paragraphs: [
        `We're sorry. The price of the ${d.giftTitle} for ${d.personName}'s ${d.occasion} on ${d.dateText} went up more than you allowed for, so we didn't buy it and you haven't been charged for it.`,
        ...alsoOrderedLines(d),
      ],
      button: { label: "Review the gift", url: links.open },
      footer: `What happens next: approve the new price, or choose a different gift. ${elseBought(d)} Choose by ${d.orderByText} so it arrives in time.`,
    }),
  }),

  out_of_stock: (d, links) => ({
    subject: `Sorry, ${d.personName}'s gift is out of stock`,
    ...renderEmail({
      heading: `Sorry, ${d.personName}'s gift is out of stock`,
      paragraphs: [
        `We're sorry. The store ran out of the ${d.giftTitle} for ${d.personName}'s ${d.occasion} on ${d.dateText}, so we didn't buy it and you haven't been charged for it.`,
        ...alsoOrderedLines(d),
      ],
      button: { label: "Choose another gift", url: links.open },
      footer: `What happens next: choose another gift by ${d.orderByText} and we'll send it in time. ${elseBought(d)}`,
    }),
  }),

  too_late: (d, links) => ({
    subject: `Sorry, ${d.personName}'s gift can't arrive in time`,
    ...renderEmail({
      heading: `Sorry, ${d.personName}'s gift can't arrive in time`,
      paragraphs: [
        `We're sorry. The ${d.giftTitle} wouldn't arrive in time for ${d.personName}'s ${d.occasion} on ${d.dateText} anymore, so we didn't buy it and you haven't been charged for it.`,
        ...alsoOrderedLines(d),
      ],
      button: { label: "See faster gifts", url: links.open },
      footer: `What happens next: you can still choose something that ships faster, by ${d.orderByText}. ${elseBought(d)}`,
    }),
  }),

  missed_on_us: (d, links) => ({
    subject: `We're sorry, we couldn't send ${d.personName}'s gift in time`,
    ...renderEmail({
      heading: `We're sorry, we couldn't send ${d.personName}'s gift in time`,
      paragraphs: [
        `You chose ${giftList(d.giftTitles)} for ${d.personName}'s ${d.occasion} on ${d.dateText}. A problem on our side stopped us placing the order before it was too late to arrive.`,
        "That's on us, and we're sorry. Nothing was bought and you haven't been charged.",
      ],
      button: { label: `Open ${d.personName}'s page`, url: links.open },
      footer: `What happens next: we're looking into what went wrong. ${NEXT_TIME(d.personName)}`,
    }),
  }),

  ordered: (d, links) => ({
    subject: `${d.personName}'s gift is ordered`,
    ...renderEmail({
      heading: `${d.personName}'s gift is ordered`,
      paragraphs: [
        `We ordered the ${d.giftTitle} for ${d.personName}'s ${d.occasion} on ${d.dateText}.` +
          (d.cityText ? ` It's on its way to ${d.cityText}.` : " It's on its way."),
      ],
      button: { label: `Open ${d.personName}'s page`, url: links.open },
    }),
  }),

  // A confirmed failure (Zinc said so, or the owner checked Zinc) after the deadline closed the round.
  failed_late: (d, links) => {
    const several = d.failed.length > 1;
    const one = d.failed[0];
    const what = several ? `${d.failed.length} of ${d.personName}'s ${d.occasion} gifts` : `${d.personName}'s gift`;
    return {
      subject: `We're sorry, we couldn't buy ${what}`,
      ...renderEmail({
        heading: `We're sorry, we couldn't buy ${what}`,
        paragraphs: [
          several
            ? `We know you were counting on these for ${d.personName}'s ${d.occasion} on ${d.dateText}, and we're sorry they didn't work out. You haven't been charged for them.`
            : `We know you were counting on the ${one.title} for ${d.personName}'s ${d.occasion} on ${d.dateText}, and we're sorry it didn't work out. ${one.detail ?? "The store couldn't place the order."} You haven't been charged for it.`,
          ...onItsWayLine(d.onItsWay),
        ],
        rows: several ? d.failed.map((f) => ({ title: f.title, ...(f.detail ? { detail: f.detail } : {}) })) : undefined,
        button: { label: d.personRemoved ? `Open ${APP_NAME}` : `Open ${d.personName}'s page`, url: links.open },
        footer: d.closedEarly
          ? "What happens next: this occasion's gifts were stopped early, so we won't buy anything more for it. You can still pick something up yourself."
          : "What happens next: it's too late for us to send another gift in time, but you can still pick something up yourself. This round is now closed.",
      }),
    };
  },

  store_cancelled_late: (d) => {
    const refund = (g: CancelledGift) => `The ${g.amountText ?? "money"} is back in your Zinc wallet.`;
    if (d.gifts.length === 1) {
      const [g] = d.gifts;
      return {
        subject: `Sorry, the store cancelled ${d.personName}'s gift`,
        ...renderEmail({
          heading: `Sorry, the store cancelled ${d.personName}'s gift`,
          paragraphs: [
            `We're sorry. ${g.store ?? "The store"} cancelled the ${g.title} for ${d.personName}'s ${d.occasion} on ${d.dateText}.`,
            refund(g),
            "It's too late for us to ship another gift in time.",
          ],
          rows: [
            { title: "Get something locally for the day", detail: "A card, flowers or something from a shop nearby." },
            { title: "Or send something a little late", detail: "Order it yourself from any store." },
          ],
          footer: `What happens next: nothing more is bought for this ${d.occasion}, and we'll start on ${d.personName}'s next occasion as usual.`,
        }),
      };
    }
    const what = `${d.gifts.length} of ${d.personName}'s gifts`;
    return {
      subject: `Sorry, the store cancelled ${what}`,
      ...renderEmail({
        heading: `Sorry, the store cancelled ${what}`,
        paragraphs: [
          `We're sorry. The store cancelled these gifts for ${d.personName}'s ${d.occasion} on ${d.dateText}.`,
          "It's too late for us to ship other gifts in time. You can get something locally for the day, or order something yourself from any store and send it a little late.",
        ],
        rows: d.gifts.map((g) => ({ title: g.title, detail: `${g.store ?? "The store"} cancelled it. ${refund(g)}` })),
        footer: `What happens next: nothing more is bought for this ${d.occasion}, and we'll start on ${d.personName}'s next occasion as usual.`,
      }),
    };
  },

  gift_late: (d, links) => {
    const title = `${d.personName}'s gift may arrive after ${theirDay(d.occasion)}`;
    return {
      subject: title,
      ...renderEmail({
        heading: title,
        paragraphs: [
          `We're sorry. The ${d.giftTitle} for ${d.personName}'s ${d.occasion} on ${d.dateText} is now expected ${d.expectedText}, ${daysLateText(d.daysLate)}.`,
          "It's already on its way, so it can't be cancelled.",
        ],
        rows: [
          { title: "Keep it", detail: `Nothing to do. It arrives ${d.expectedText}.` },
          { title: "Get something locally for the day", detail: `Then return the ${d.giftTitle} once it arrives, if you like.` },
        ],
        ...(links.arrived ? { button: { label: "It already arrived", url: links.arrived } } : {}),
        footer: "What happens next: we keep watching it. If it's back on time, we'll let you know.",
      }),
    };
  },

  gift_on_time: (d, links) => {
    const title = `Good news: ${d.personName}'s gift is back on time`;
    return {
      subject: title,
      ...renderEmail({
        heading: title,
        paragraphs: [
          `The ${d.giftTitle} is now expected ${d.expectedText}, in time for ${d.personName}'s ${d.occasion} on ${d.dateText}.`,
          "There's nothing you need to do.",
        ],
        link: { label: `See ${d.personName}'s gift`, url: links.open },
      }),
    };
  },

  delivered: (d, links) => {
    const title = `${d.personName}'s gift was delivered`;
    return {
      subject: title,
      ...renderEmail({
        heading: title,
        paragraphs: [`Everything you chose for ${d.personName}'s ${d.occasion} on ${d.dateText} has arrived.`],
        rows: d.gifts.map((g) => ({ title: g.title, detail: g.deliveredText ? `Delivered ${g.deliveredText}` : "Delivered" })),
        link: { label: `See ${d.personName}'s gift`, url: links.open },
        footer: "What happens next: after the occasion we'll ask how they liked it.",
      }),
    };
  },

  // Bad news first, with an apology (owner, 2026-11-23); the caller orders the items.
  tracking_news: (d) => {
    const bad = d.items.filter((i) => i.kind !== "on_time").length;
    const good = d.items.length - bad;
    const has = (n: number) => (n === 1 ? "has" : "have");
    const lead =
      bad === 0
        ? `Good news: ${countWord(good)} of your gifts ${good === 1 ? "is" : "are"} back on time. There's nothing you need to do.`
        : `We're sorry, ${countWord(bad)} of your gifts ${has(bad)} bad news.` +
          (good > 0 ? ` ${capitalize(countWord(good))} ${has(good)} good news.` : "");
    const title = `Updates on ${d.items.length} of your gifts`;
    const footer = newsFooter(
      d.items.some((i) => i.kind === "late"),
      d.items.some((i) => i.kind === "cancelled"),
    );
    return {
      subject: title,
      ...renderEmail({ heading: title, paragraphs: [lead], rows: d.items.map(newsRow), ...(footer ? { footer } : {}) }),
    };
  },

  failed_several: (d, links) => {
    // A store-cancelled gift was bought and refunded: never "couldn't be bought" or "not charged" (ALL-33).
    const n = d.failed.length;
    const refunded = d.failed.filter((f) => f.refunded).length;
    const others = n - refunded;
    const title =
      refunded === 0
        ? `Sorry, ${n} of ${d.personName}'s ${d.occasion} gifts couldn't be bought`
        : refunded === n
          ? `Sorry, the store cancelled ${n} of ${d.personName}'s ${d.occasion} gifts`
          : `Sorry, ${n} of ${d.personName}'s ${d.occasion} gifts need another choice`;
    const lead =
      refunded === 0
        ? `We're sorry. We tried to order ${d.tried} gifts for ${d.personName}'s ${d.occasion} on ${d.dateText}, and ` +
          (n >= d.tried ? `${d.tried === 2 ? "neither" : "none"} of them went through.` : `${n} of them didn't go through.`) +
          ` You haven't been charged for ${n === 2 ? "either" : "them"}.`
        : refunded === n
          ? `We're sorry. The store cancelled ${n} of the gifts we ordered for ${d.personName}'s ${d.occasion} on ${d.dateText}. The money for them is back in your Zinc wallet.`
          : `We're sorry. Of the gifts we tried for ${d.personName}'s ${d.occasion} on ${d.dateText}, the store cancelled ${refunded} and ${others} didn't go through. ` +
            `The money for the cancelled ${refunded === 1 ? "gift" : "gifts"} is back in your Zinc wallet, and you haven't been charged for the ${others === 1 ? "other" : "others"}.`;
    return {
      subject: title,
      ...renderEmail({
        heading: title,
        paragraphs: [lead, ...alsoOrderedLines(d)],
        rows: d.failed.map((f) => ({ title: f.title, detail: f.detail })),
        button: { label: `Open ${d.personName}'s page`, url: links.open },
        link: d.failed.filter((f) => f.action).map((f) => ({ label: f.action as string, url: f.url })),
        footer: `What happens next: there's still time to put this right. ${d.working?.length ? elseBought(d) : "Nothing else is bought until you choose."} Choose by ${d.orderByText} so it arrives in time. If you don't, we'll close this round then and let you know.`,
      }),
    };
  },

  check_your_address: (_d, links) => ({
    subject: "Please check your saved address",
    ...renderEmail({
      heading: "Please check your saved address",
      paragraphs: ["Please check your saved address is current. It's used if someone sends you a gift through your list."],
      button: { label: "Check my address", url: links.open },
    }),
  }),

  // ─── ALL-31: emailed notes. Copy from design/plans/ALL-31-email-capture.md > How it works ───

  // Answered by replying, so no button. Sent with the notes address as Reply-To (AC-15).
  notes_tip: (d) => ({
    subject: `Did you know? You can email us notes about ${d.personName}`,
    ...renderEmail({
      heading: "Did you know?",
      paragraphs: [
        `Reply to this with anything you learn about ${d.personName}, like "wants a new fly rod", and we'll remember it.`,
      ],
      footer: "You can attach a photo or screenshot too.",
    }),
  }),

  // Every choice is equal, so each is a plain link; the shell allows only one button (T33).
  who_is_this: (d, links) => ({
    subject: "Who is your note about?",
    ...renderEmail({
      heading: "Who is your note about?",
      paragraphs: [
        `We got your note${d.subject ? ` "${d.subject}"` : ""}, but couldn't tell who it's about. Tap who it's for and we'll add it to their page.`,
      ],
      link: [
        ...d.choices.map((c, i) => ({ label: c.name, url: choiceLink(links, i) })),
        { label: "Someone else", url: links.someoneElse },
      ],
      footer: "Someone else? Add them on your people page, then send the note again. Each name works once.",
    }),
  }),

  // Once ever, to an account without paid features (AC-10).
  notes_not_read: () => ({
    subject: "We didn't read your note",
    ...renderEmail({
      heading: "We didn't read your note",
      paragraphs: [
        "Thanks for your note. Emailed notes are read only for test accounts during the alpha, so we didn't keep or read this one.",
        "We'll only tell you this once. Notes you email later won't be kept either.",
      ],
    }),
  }),

  // After filing a note that sounds like stopping a gift (AC-14).
  notes_cant_cancel: () => ({
    subject: "Replies can't cancel a gift",
    ...renderEmail({
      heading: "We saved your note",
      paragraphs: [
        "We saved your note. Just so you know, replies can't cancel a gift.",
        "To cancel or skip one, use the button in the email about it.",
      ],
    }),
  }),

  // True whether nothing fit, a service was down, or we know too little (ALL-27 AC-9), in the ALL-116 tone.
  no_ideas: (d, links) => ({
    subject: `Sorry, we couldn't get gift ideas for ${d.personName} yet`,
    ...renderEmail({
      heading: `Sorry, we couldn't get gift ideas for ${d.personName} yet`,
      paragraphs: d.again
        ? [`We're sorry. We tried again and still couldn't find a good fit for ${d.personName}. You haven't been charged.`]
        : [`We're sorry. We don't have gift ideas for ${d.personName} yet. You haven't been charged.`],
      button: { label: `Tell us more about ${d.personName}`, url: links.questions },
      footer: d.again
        ? // No retry is promised: the one extra run may already be spent.
          `What happens next: we'll skip this occasion. Telling us more about ${d.personName} helps us next time.`
        : `What happens next: telling us more about ${d.personName} helps. We'll try once more after you add something. Otherwise, we'll let you know before the date passes.`,
    }),
  }),
};

const IDEAS: IdeaRow[] = [
  { title: "Stoneware mug set", price: "$42", arriveBy: "Mar 5", store: "Amazon", reason: "Loves tea." },
  { title: "Cast-iron herb planter", price: "$68", arriveBy: "Mar 7", store: "Amazon", reason: "Grows herbs on the balcony." },
  { title: "Audiobook credits", price: "$45", arriveBy: "Mar 4", store: "Audible", reason: "On their list." },
];
const BUY_LINKS = {
  choose: "https://example.com/rounds/r1",
  buy0: "https://example.com/rounds/r1/buy?ideas=i0",
  buy1: "https://example.com/rounds/r1/buy?ideas=i1",
  buy2: "https://example.com/rounds/r1/buy?ideas=i2",
};
const OCC = { personName: "Mom", occasion: "birthday", dateText: "Saturday, March 14" };
const GIFT = { ...OCC, giftTitles: ["Le Creuset mug set"] };
const ONE_GIFT = { ...OCC, giftTitle: "Le Creuset mug set" };
const FAILURE = { ...ONE_GIFT, orderByText: "Thursday, March 5" };

export const SAMPLE_DATA: {
  [K in NotificationKind]: { data: TemplateData[K]; links: TemplateLinks[K] };
} = {
  test: { data: {}, links: { tryIt: "https://example.com/a/test-token" } },
  heads_up: {
    data: { ...OCC, mode: "reminder", ideas: IDEAS },
    links: BUY_LINKS,
  },
  reminder: {
    data: { ...OCC, ideas: IDEAS },
    links: BUY_LINKS,
  },
  final_notice: {
    data: { ...OCC, ideas: IDEAS, orderByText: "Thursday, March 12" },
    links: BUY_LINKS,
  },
  needs_attention: {
    data: { ...OCC, reason: "the store couldn't place the order for the Le Creuset mug set, and you haven't been charged for it.", orderByText: "Thursday, March 5" },
    links: { open: "https://example.com/rounds/r1/fix/o1" },
  },
  reaction_prompt: {
    data: { rounds: [{ ...OCC, gifts: [{ title: "Cozy throw blanket" }, { title: "Reading lamp" }] }] },
    links: Object.fromEntries([0, 1].flatMap((i) => RATINGS.map((r) => [`${r}${i}`, `https://example.com/rounds/r1/reaction/${r}${i}`]))),
  },
  needs_address: { data: OCC, links: { addAddress: "https://example.com/a/address-token" } },
  skipped: { data: OCC, links: { open: "https://example.com/a/skipped-token" } },
  hold_funds: {
    data: {
      ...GIFT,
      neededText: "$46.20",
      haveText: "$12",
      shortText: "$34.20",
      feeText: "$1",
      walletUrl: "https://example.com/zinc-wallet",
    },
    links: { cancel: "https://example.com/a/cancel-token" },
  },
  hold_setup: {
    data: { ...GIFT, feeText: "$1" },
    links: { setup: "https://example.com/a/setup-token", cancel: "https://example.com/a/cancel-token" },
  },
  hold_address: {
    data: { ...GIFT, feeText: "$1" },
    links: { addAddress: "https://example.com/a/address-token", cancel: "https://example.com/a/cancel-token" },
  },
  hold_trouble: {
    data: { ...GIFT, feeText: "$1" },
    links: { open: "https://example.com/a/open-token", cancel: "https://example.com/a/cancel-token" },
  },
  hold_unconfirmed: { data: GIFT, links: { open: "https://example.com/a/open-token" } },
  price_up: { data: FAILURE, links: { open: "https://example.com/a/open-token" } },
  out_of_stock: { data: FAILURE, links: { open: "https://example.com/a/open-token" } },
  too_late: { data: FAILURE, links: { open: "https://example.com/a/open-token" } },
  missed_on_us: { data: GIFT, links: { open: "https://example.com/a/open-token" } },
  ordered: { data: { ...ONE_GIFT, cityText: "Dayton" }, links: { open: "https://example.com/a/open-token" } },
  failed_late: {
    data: { ...OCC, failed: [{ title: "Le Creuset mug set", detail: "The store ran out." }] },
    links: { open: "https://example.com/a/open-token" },
  },
  failed_several: {
    data: {
      ...OCC,
      tried: 3,
      failed: [
        {
          title: "Le Creuset mug set",
          detail: "The price went up more than you allowed for. Approve the new price, or choose another gift.",
          action: "Review the new price for the Le Creuset mug set",
          url: "https://example.com/rounds/r1/fix/o1",
        },
        {
          title: "Linen apron",
          detail: "The store ran out. Choose another gift.",
          action: "Choose another gift instead of the Linen apron",
          url: "https://example.com/rounds/r1/fix/o2",
        },
      ],
      onItsWay: ["Cast-iron herb planter"],
      orderByText: "Thursday, March 5",
    },
    links: { open: "https://example.com/a/open-token" },
  },
  store_cancelled_late: {
    data: { ...OCC, gifts: [{ title: "Le Creuset mug set", store: "Walmart", amountText: "$42.18" }] },
    links: {},
  },
  tracking_news: {
    data: {
      items: [
        { kind: "late", ...OCC, title: "Cozy throw blanket", expectedText: "Monday, March 16", daysLate: 2, url: "https://example.com/rounds/r1" },
        { kind: "cancelled", ...OCC, title: "Reading lamp", amountText: "$34.50" },
        { kind: "on_time", personName: "Dad", occasion: "birthday", dateText: "Friday, March 20", title: "Tea sampler", expectedText: "Wednesday, March 18" },
      ],
    },
    links: {},
  },
  delivered: {
    data: { ...OCC, gifts: [{ title: "Cozy throw blanket", deliveredText: "Friday, March 13" }, { title: "Reading lamp", deliveredText: "Saturday, March 14" }] },
    links: { open: "https://example.com/rounds/r1" },
  },
  gift_late: {
    data: { ...OCC, giftTitle: "Cozy throw blanket", expectedText: "Monday, March 16", daysLate: 2 },
    links: { arrived: "https://example.com/rounds/r1" },
  },
  gift_on_time: {
    data: { ...OCC, giftTitle: "Cozy throw blanket", expectedText: "Friday, March 13" },
    links: { open: "https://example.com/rounds/r1" },
  },
  check_your_address: { data: {}, links: { open: "https://example.com/a/open-token" } },
  notes_tip: { data: { personName: "Dad" }, links: {} },
  who_is_this: {
    data: { subject: "Fly rod", choices: [{ name: "Dad" }, { name: "Uncle Bob" }] },
    links: {
      choice0: "https://example.com/a/choice0-token",
      choice1: "https://example.com/a/choice1-token",
      someoneElse: "https://example.com/people",
    },
  },
  notes_not_read: { data: {}, links: {} },
  notes_cant_cancel: { data: {}, links: {} },
  no_ideas: { data: { personName: "Mom", again: false }, links: { questions: "https://example.com/a/questions-token" } },
};
