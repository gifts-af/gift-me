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
  // ALL-112: to a list owner, whose shared address a store couldn't use. Says nothing of a gift.
  | "check_your_address";

export type RenderedEmail = { subject: string; html: string; text: string };

// Everything is already formatted by the caller (dates, prices).
export type IdeaRow = { title: string; price: string };

type Occasion = { personName: string; occasion: string; dateText: string };

/** How many guided questions are open for the person (ALL-26), when any are. */
type Asks = { questions?: number };

/** The heads-up's low-balance warning (AC-11): money already formatted, plus the Zinc wallet page. */
export type Funding = { dueText: string; haveText: string; atLeast: boolean; windowText: string; walletUrl: string };

/** The gifts the buyer chose, by title. */
type Gifts = Occasion & { giftTitles: string[] };
/** One gift, by title. */
type OneGift = Occasion & { giftTitle: string };
/** One failed gift while the round is open; `orderByText`: the last day to choose again in time. */
type Failure = OneGift & { orderByText: string };
/** A failed gift in a summary (ALL-116): what happened, and the link text for what to do now. */
export type FailedGift = { title: string; detail: string; action?: string };

export type TemplateData = {
  test: Record<string, never>;
  heads_up:
    | (Occasion & Asks & { mode: "reminder"; ideas: IdeaRow[]; late?: boolean; funding?: Funding })
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
  needs_attention: Occasion & { reason: string; orderByText?: string };
  reaction_prompt: { personName: string; occasion: string; giftTitle: string };
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
  failed_several: Occasion & { tried: number; failed: FailedGift[]; onItsWay?: string[]; orderByText: string };
  check_your_address: Record<string, never>;
};

export type TemplateLinks = {
  test: { tryIt: string };
  // `skip`, when given, is shown as a plain link to copy; the button stays the only anchor.
  heads_up: { choose: string; skip?: string; questions?: string };
  reminder: { choose: string; questions?: string };
  final_notice: { choose: string };
  needs_attention: { open: string };
  reaction_prompt: { open: string };
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
  // Until ALL-29, every gift's link opens the person's page too.
  failed_several: { open: string };
  check_your_address: { open: string };
};

const rowsOf = (ideas: IdeaRow[]) => ideas.map((i) => ({ title: `${i.title} · ${i.price}` }));

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

const itOrThem = (titles: string[]) => (titles.length > 1 ? "them" : "it");

/** "The Mug is ordered and on its way.", for the round's gifts already placed; nothing when none. */
function onItsWayLine(titles: string[] | undefined, lead = ""): string[] {
  if (!titles || titles.length === 0) return [];
  const list = giftList(titles);
  const sentence = `${titles.length > 1 ? `${list} are` : `${list} is`} ordered and on ${titles.length > 1 ? "their" : "its"} way.`;
  return [lead ? `${lead}${sentence}` : capitalize(sentence)];
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
    return {
      subject: `${d.personName}'s ${d.occasion}: ${d.ideas.length} gifts from their list`,
      ...renderEmail({
        heading: `${d.personName}'s ${d.occasion} is coming up`,
        paragraphs: [
          `${d.personName}'s ${d.occasion} is ${d.dateText}. These gifts can still arrive in time.`,
          ...late,
        ],
        rows: rowsOf(d.ideas),
        warning: funding.warning,
        button: { label: "Choose a gift", url: links.choose },
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
      rows: rowsOf(d.ideas),
      button: { label: "Choose a gift", url: links.choose },
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
      rows: rowsOf(d.ideas),
      button: { label: "Choose a gift", url: links.choose },
      footer: `Nothing is bought until you choose. ${PRICES_NOTE}`,
    }),
  }),

  needs_attention: (d, links) => ({
    subject: `Sorry, there's a problem with ${d.personName}'s gift`,
    ...renderEmail({
      heading: `Sorry, there's a problem with ${d.personName}'s gift`,
      paragraphs: [`We're sorry. We couldn't finish the gift for ${d.personName}'s ${d.occasion} on ${d.dateText}: ${d.reason}`],
      button: { label: `Open ${d.personName}'s page`, url: links.open },
      footer: d.orderByText
        ? `What happens next: nothing else is bought until you choose. Choose another gift by ${d.orderByText} so it arrives in time.`
        : `What happens next: ${NEXT_TIME(d.personName)}`,
    }),
  }),

  reaction_prompt: (d, links) => ({
    subject: `How did ${d.personName} like the gift?`,
    ...renderEmail({
      heading: `How did ${d.personName} like it?`,
      paragraphs: [
        `${d.giftTitle} should have reached ${d.personName} for their ${d.occasion}.`,
        "Tell us how it went and we'll choose better next time.",
      ],
      button: { label: "Tell us", url: links.open },
    }),
  }),

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
        `We're sorry. The price of the ${d.giftTitle} for ${d.personName}'s ${d.occasion} on ${d.dateText} went up more than you allowed for, so we didn't buy it and you haven't been charged.`,
      ],
      button: { label: "Review the gift", url: links.open },
      footer: `What happens next: approve the new price, or choose a different gift. Nothing is bought until you choose. Choose by ${d.orderByText} so it arrives in time.`,
    }),
  }),

  out_of_stock: (d, links) => ({
    subject: `Sorry, ${d.personName}'s gift is out of stock`,
    ...renderEmail({
      heading: `Sorry, ${d.personName}'s gift is out of stock`,
      paragraphs: [
        `We're sorry. The store ran out of the ${d.giftTitle} for ${d.personName}'s ${d.occasion} on ${d.dateText}, so we didn't buy it and you haven't been charged.`,
      ],
      button: { label: "Choose another gift", url: links.open },
      footer: `What happens next: choose another gift by ${d.orderByText} and we'll send it in time. Nothing is bought until you choose.`,
    }),
  }),

  too_late: (d, links) => ({
    subject: `Sorry, ${d.personName}'s gift can't arrive in time`,
    ...renderEmail({
      heading: `Sorry, ${d.personName}'s gift can't arrive in time`,
      paragraphs: [
        `We're sorry. The ${d.giftTitle} wouldn't arrive in time for ${d.personName}'s ${d.occasion} on ${d.dateText} anymore, so we didn't buy it and you haven't been charged.`,
      ],
      button: { label: "See faster gifts", url: links.open },
      footer: `What happens next: you can still choose something that ships faster, by ${d.orderByText}. Nothing is bought until you choose.`,
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
          (d.cityText ? ` It's on its way to ${d.cityText}.` : " It's on its way.") +
          " We'll let you know when it ships.",
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

  failed_several: (d, links) => ({
    subject: `Sorry, ${d.failed.length} of ${d.personName}'s ${d.occasion} gifts couldn't be bought`,
    ...renderEmail({
      heading: `Sorry, ${d.failed.length} of ${d.personName}'s ${d.occasion} gifts couldn't be bought`,
      paragraphs: [
        `We're sorry. We tried to order ${d.tried} gifts for ${d.personName}'s ${d.occasion} on ${d.dateText}, and ` +
          (d.failed.length >= d.tried
            ? `${d.tried === 2 ? "neither" : "none"} of them went through.`
            : `${d.failed.length} of them didn't go through.`) +
          ` You haven't been charged for ${d.failed.length === 2 ? "either" : "them"}.`,
        ...onItsWayLine(d.onItsWay, "The good news: "),
      ],
      rows: d.failed.map((f) => ({ title: f.title, detail: f.detail })),
      button: { label: `Open ${d.personName}'s page`, url: links.open },
      link: d.failed.filter((f) => f.action).map((f) => ({ label: f.action as string, url: links.open })),
      footer: `What happens next: there's still time to put this right. Nothing else is bought until you choose. Choose by ${d.orderByText} so it arrives in time. If you don't, we'll close this round then and let you know.`,
    }),
  }),

  check_your_address: (_d, links) => ({
    subject: "Please check your saved address",
    ...renderEmail({
      heading: "Please check your saved address",
      paragraphs: ["Please check your saved address is current. It's used if someone sends you a gift through your list."],
      button: { label: "Check my address", url: links.open },
    }),
  }),
};

const IDEAS: IdeaRow[] = [
  { title: "Stoneware mug set", price: "$42" },
  { title: "Cast-iron herb planter", price: "$68" },
  { title: "Audiobook credits", price: "$45" },
];
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
    links: { choose: "https://example.com/a/heads-up-token" },
  },
  reminder: {
    data: { ...OCC, ideas: IDEAS },
    links: { choose: "https://example.com/a/reminder-token" },
  },
  final_notice: {
    data: { ...OCC, ideas: IDEAS, orderByText: "Thursday, March 12" },
    links: { choose: "https://example.com/a/final-token" },
  },
  needs_attention: {
    data: { ...OCC, reason: "the store couldn't place the order for the Le Creuset mug set, and you haven't been charged.", orderByText: "Thursday, March 5" },
    links: { open: "https://example.com/a/attention-token" },
  },
  reaction_prompt: {
    data: { personName: "Mom", occasion: "birthday", giftTitle: "The stoneware mug set" },
    links: { open: "https://example.com/a/reaction-token" },
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
        },
        { title: "Linen apron", detail: "The store ran out. Choose another gift.", action: "Choose another gift instead of the Linen apron" },
      ],
      onItsWay: ["Cast-iron herb planter"],
      orderByText: "Thursday, March 5",
    },
    links: { open: "https://example.com/a/open-token" },
  },
  check_your_address: { data: {}, links: { open: "https://example.com/a/open-token" } },
};
