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
  | "ordered";

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
/** One failed gift. */
type OneGift = Occasion & { giftTitle: string };

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
  needs_attention: Occasion & { reason: string };
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
  price_up: OneGift;
  out_of_stock: OneGift;
  too_late: OneGift;
  missed_on_us: Gifts;
  /** City only, never the full address. */
  ordered: OneGift & { cityText?: string };
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
};

const rowsOf = (ideas: IdeaRow[]) => ideas.map((i) => ({ title: `${i.title} · ${i.price}` }));

const PRICES_NOTE = "Prices include shipping and tax.";

function skippedEmail(d: TemplateData["skipped"], links: TemplateLinks["skipped"]): RenderedEmail {
  return {
    subject: `No gift for ${d.personName}'s ${d.occasion} this time`,
    ...renderEmail({
      heading: `No gift for ${d.personName}'s ${d.occasion}`,
      paragraphs: [
        d.held
          ? `The gift you chose for ${d.personName}'s ${d.occasion} (${d.dateText}) couldn't be bought in time, so nothing was bought or charged.`
          : `No gift was chosen for ${d.personName}'s ${d.occasion} (${d.dateText}), so nothing was bought.`,
        "You can still buy something yourself. We'll be back for the next occasion.",
      ],
      button: { label: `Open ${APP_NAME}`, url: links.open },
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

/** Every hold email ends the same way (owner): what topping up or fixing it means, and how to back out. */
function holdEnd(cancel: string, alpha: string) {
  return { note: `Alpha: ${alpha}`, cancel: { before: "Changed your mind?", label: "Cancel this gift", url: cancel } };
}

const alphaBuy = (feeText: string) => `once this is sorted, we'll buy this gift, its price plus Zinc's ${feeText} fee.`;

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
    subject: `${d.personName}'s ${d.occasion} gift needs your attention`,
    ...renderEmail({
      heading: `${d.personName}'s gift needs your attention`,
      paragraphs: [
        `We couldn't finish the gift for ${d.personName}'s ${d.occasion} on ${d.dateText}: ${d.reason}`,
        "Open it to see what to do next.",
      ],
      button: { label: "Open it", url: links.open },
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
          subject: `One of ${d.personName}'s gifts couldn't be bought in time`,
          ...renderEmail({
            heading: d.partial.onItsWay.length > 0 ? `${d.personName}'s other gift is on its way` : `We cancelled one of ${d.personName}'s gifts`,
            paragraphs: [
              `We couldn't buy ${giftList(d.partial.cancelled)} for ${d.personName} in time, so we cancelled ${itOrThem(d.partial.cancelled)}. Nothing was charged for ${itOrThem(d.partial.cancelled)}.` +
                (d.partial.onItsWay.length > 0
                  ? ` ${capitalize(giftList(d.partial.onItsWay))} ${d.partial.onItsWay.length > 1 ? "are on their way" : "is on its way"}.`
                  : ""),
            ],
            button: { label: `Open ${d.personName}'s page`, url: links.open },
          }),
        }
      : skippedEmail(d, links),

  // ─── ALL-32: approved mock-ups, design/mockups/ALL-32-emails.html and ALL-32-emails-2.html ───

  hold_funds: (d, links) => {
    const end = holdEnd(
      links.cancel,
      `topping up means we'll buy this gift, its price plus Zinc's ${d.feeText} fee.`,
    );
    return {
      subject: d.still && d.shortText
        ? `You're still ${d.shortText} short for ${d.personName}'s gift`
        : `${d.personName}'s gift is waiting on your Zinc balance`,
      ...renderEmail({
        heading: `Top up to send ${d.personName}'s gift`,
        paragraphs: [
          `You chose ${giftList(d.giftTitles)} for ${d.personName}'s ${d.occasion} on ${d.dateText}.` +
            (d.placedTitle ? ` The ${d.placedTitle} is on its way.` : "") +
            ` Zinc needs ${d.neededText} in your balance to buy ${itOrThem(d.giftTitles)} (the gift with room for a small price change, plus Zinc's ${d.feeText} fee).` +
            (d.haveText && d.shortText ? ` You have ${d.haveText}, so you're ${d.still ? "still " : ""}${d.shortText} short.` : ""),
          "Add funds in Zinc and we'll buy it as soon as we see them, usually within a day. There's no need to come back.",
        ],
        button: { label: "Top up your Zinc balance", url: d.walletUrl },
        note: end.note,
        // Its own line: a long sentence in front of the link would wrap around the tall tap target.
        tip: "To avoid this next time, turn on auto top-up in Zinc.",
        link: end.cancel,
      }),
    };
  },

  hold_setup: (d, links) => {
    const end = holdEnd(links.cancel, alphaBuy(d.feeText));
    return {
      subject: `Finish setting up payment to send ${d.personName}'s gift`,
      ...renderEmail({
        heading: "Finish setting up payment",
        paragraphs: [
          `You chose ${giftList(d.giftTitles)} for ${d.personName}'s ${d.occasion} on ${d.dateText}. Gifts are paid from your own Zinc balance. Connect Zinc and add your phone in Settings.`,
          `It takes about a minute. Once it's connected and funded, we'll buy ${itOrThem(d.giftTitles)}.`,
        ],
        button: { label: "Finish setup", url: links.setup },
        note: end.note,
        link: end.cancel,
      }),
    };
  },

  hold_address: (d, links) => {
    const end = holdEnd(links.cancel, alphaBuy(d.feeText));
    return {
      subject: `${d.personName}'s gift needs an address`,
      ...renderEmail({
        heading: `${d.personName}'s gift needs an address`,
        paragraphs: [
          `You chose ${giftList(d.giftTitles)} for ${d.personName}'s ${d.occasion} on ${d.dateText}, but we don't have an address we can ship to.`,
          "Add or fix it and we'll send the gift straight away. There's nothing else to do.",
        ],
        button: { label: "Fix the address", url: links.addAddress },
        note: end.note,
        link: end.cancel,
      }),
    };
  },

  hold_trouble: (d, links) => {
    const end = holdEnd(links.cancel, alphaBuy(d.feeText));
    return {
      subject: `We're having trouble ordering ${d.personName}'s gift`,
      ...renderEmail({
        heading: `Still trying to order ${d.personName}'s gift`,
        paragraphs: [
          `Our ordering service has been having trouble since you chose ${giftList(d.giftTitles)}. Nothing has been charged.`,
          "We'll keep trying and email you when it's placed. If you'd rather not wait, you can cancel it or choose another gift.",
        ],
        button: { label: `Open ${d.personName}'s page`, url: links.open },
        note: end.note,
        link: end.cancel,
      }),
    };
  },

  hold_unconfirmed: (d, links) => ({
    subject: `We're confirming ${d.personName}'s gift with the store`,
    ...renderEmail({
      heading: `Confirming ${d.personName}'s gift`,
      paragraphs: [
        `We sent the order for ${giftList(d.giftTitles)}, but haven't had confirmation from the store yet.`,
        "We're checking on it now. You won't be charged twice, and we'll email you as soon as we know.",
      ],
      button: { label: `Open ${d.personName}'s page`, url: links.open },
    }),
  }),

  price_up: (d, links) => ({
    subject: `The price of ${d.personName}'s gift went up`,
    ...renderEmail({
      heading: `${d.personName}'s gift went up in price`,
      paragraphs: [
        `The price of the ${d.giftTitle} went up more than we allowed for, so we didn't buy it and nothing was charged.`,
        `Approve the new price, or choose a different gift for ${d.personName}'s ${d.occasion} on ${d.dateText}.`,
      ],
      button: { label: "Review the gift", url: links.open },
      footer: "Nothing is bought until you choose.",
    }),
  }),

  out_of_stock: (d, links) => ({
    subject: `${d.personName}'s gift is out of stock`,
    ...renderEmail({
      heading: `${d.personName}'s gift is out of stock`,
      paragraphs: [
        `The store ran out of the ${d.giftTitle}, so we didn't buy it and nothing was charged.`,
        `Choose another gift and we'll send it in time for ${d.personName}'s ${d.occasion} on ${d.dateText}.`,
      ],
      button: { label: "Choose another gift", url: links.open },
    }),
  }),

  too_late: (d, links) => ({
    subject: `${d.personName}'s gift can't arrive in time`,
    ...renderEmail({
      heading: `Too late for ${d.personName}'s gift`,
      paragraphs: [
        `The ${d.giftTitle} wouldn't arrive in time for ${d.personName}'s ${d.occasion} on ${d.dateText} anymore, so we didn't buy it and nothing was charged.`,
        "You can still pick something that ships faster.",
      ],
      button: { label: "See faster gifts", url: links.open },
    }),
  }),

  missed_on_us: (d, links) => ({
    subject: `We couldn't send ${d.personName}'s gift in time`,
    ...renderEmail({
      heading: `We couldn't send ${d.personName}'s gift in time`,
      paragraphs: [
        `You chose ${giftList(d.giftTitles)} for ${d.personName}'s ${d.occasion} on ${d.dateText}. A problem on our side stopped us placing the order before it was too late to arrive.`,
        "That's on us. Nothing was bought and nothing was charged.",
      ],
      button: { label: `Open ${d.personName}'s page`, url: links.open },
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
};

const IDEAS: IdeaRow[] = [
  { title: "Stoneware mug set", price: "$42" },
  { title: "Cast-iron herb planter", price: "$68" },
  { title: "Audiobook credits", price: "$45" },
];
const OCC = { personName: "Mom", occasion: "birthday", dateText: "Saturday, March 14" };
const GIFT = { ...OCC, giftTitles: ["Le Creuset mug set"] };
const ONE_GIFT = { ...OCC, giftTitle: "Le Creuset mug set" };

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
    data: { ...OCC, reason: "the payment didn't go through." },
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
  price_up: { data: ONE_GIFT, links: { open: "https://example.com/a/open-token" } },
  out_of_stock: { data: ONE_GIFT, links: { open: "https://example.com/a/open-token" } },
  too_late: { data: ONE_GIFT, links: { open: "https://example.com/a/open-token" } },
  missed_on_us: { data: GIFT, links: { open: "https://example.com/a/open-token" } },
  ordered: { data: { ...ONE_GIFT, cityText: "Dayton" }, links: { open: "https://example.com/a/open-token" } },
};
