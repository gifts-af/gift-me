import { type NotificationKind, type RenderedEmail, SAMPLE_DATA, TEMPLATES } from "./templates";

export type SampleEmail = { name: string; email: RenderedEmail };

// Typed loosely: the table is keyed per kind, the loop is generic.
type AnyTemplate = (data: unknown, links: unknown) => RenderedEmail;

function linksTo<T extends object>(links: T, link: string): T {
  return Object.fromEntries(Object.keys(links).map((k) => [k, link])) as T;
}

/**
 * One rendered sample of every email, with every button pointing at `link`.
 * Heads-up comes in both modes. Used by the phone-check scripts (ALL-23, ALL-60).
 */
export function sampleEmails(link: string): SampleEmail[] {
  const list: SampleEmail[] = [];
  const add = (name: string, kind: NotificationKind, data: unknown, links: object) =>
    list.push({ name, email: (TEMPLATES[kind] as AnyTemplate)(withWallet(data, link), linksTo(links, link)) });
  for (const kind of Object.keys(SAMPLE_DATA) as NotificationKind[]) {
    const { data, links } = SAMPLE_DATA[kind];
    if (kind === "heads_up") {
      const base = SAMPLE_DATA.heads_up.data;
      const autoBuy = { ...base, mode: "auto_buy", autoBuyIdea: base.ideas[0].title, autoBuyDate: "Tuesday, March 10" };
      add("heads_up-reminder", kind, base, links);
      add("heads_up-auto_buy", kind, autoBuy, { ...links, skip: link });
      const funding = { dueText: "$160", haveText: "$40", atLeast: false, windowText: "the next 3 weeks", walletUrl: link };
      add("heads_up-funding", kind, { ...base, funding }, links);
      continue;
    }
    add(kind, kind, data, links);
    if (kind === "reminder") add("reminder-questions", kind, { ...SAMPLE_DATA.reminder.data, questions: 3 }, { ...links, questions: link });
    if (kind === "skipped") add("skipped-held", kind, { ...SAMPLE_DATA.skipped.data, held: true }, links);
    if (kind === "hold_funds") {
      add("hold_funds-still", kind, { ...SAMPLE_DATA.hold_funds.data, still: true, placedTitle: "Linen apron" }, links);
    }
  }
  return list;
}

/** The Zinc wallet address some emails carry as data points at `link` too. */
function withWallet(data: unknown, link: string): unknown {
  return data && typeof data === "object" && "walletUrl" in data ? { ...data, walletUrl: link } : data;
}
