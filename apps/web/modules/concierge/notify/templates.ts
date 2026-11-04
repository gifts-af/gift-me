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
  | "skipped";

export type RenderedEmail = { subject: string; html: string; text: string };

// Everything is already formatted by the caller (dates, prices).
export type IdeaRow = { title: string; price: string };

type Occasion = { personName: string; occasion: string; dateText: string };

/** How many guided questions are open for the person (ALL-26), when any are. */
type Asks = { questions?: number };

export type TemplateData = {
  test: Record<string, never>;
  heads_up:
    | (Occasion & Asks & { mode: "reminder"; ideas: IdeaRow[]; late?: boolean })
    | (Occasion & Asks & {
        mode: "auto_buy";
        ideas: IdeaRow[];
        autoBuyIdea: string;
        autoBuyDate: string;
        late?: boolean;
      });
  reminder: Occasion & Asks & { ideas: IdeaRow[] };
  final_notice: Occasion & { ideas: IdeaRow[]; orderByText: string };
  needs_attention: Occasion & { reason: string };
  reaction_prompt: { personName: string; occasion: string; giftTitle: string };
  needs_address: Occasion & { reminder?: boolean };
  skipped: Occasion;
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
};

const rowsOf = (ideas: IdeaRow[]) => ideas.map((i) => ({ title: `${i.title} · ${i.price}` }));

const PRICES_NOTE = "Prices include shipping and tax.";

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
          button: { label: "Review or change", url: links.choose },
          link: questionsLink(d, links.questions),
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
        button: { label: "Choose a gift", url: links.choose },
        link: questionsLink(d, links.questions),
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

  skipped: (d, links) => ({
    subject: `No gift for ${d.personName}'s ${d.occasion} this time`,
    ...renderEmail({
      heading: `No gift for ${d.personName}'s ${d.occasion}`,
      paragraphs: [
        `No gift was chosen for ${d.personName}'s ${d.occasion} (${d.dateText}), so nothing was bought.`,
        "You can still buy something yourself. We'll be back for the next occasion.",
      ],
      button: { label: `Open ${APP_NAME}`, url: links.open },
    }),
  }),
};

const IDEAS: IdeaRow[] = [
  { title: "Stoneware mug set", price: "$42" },
  { title: "Cast-iron herb planter", price: "$68" },
  { title: "Audiobook credits", price: "$45" },
];
const OCC = { personName: "Mom", occasion: "birthday", dateText: "Saturday, March 14" };

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
};
