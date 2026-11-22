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
      const overBudget = [...base.ideas.slice(0, 2), { title: "Espresso machine", price: "$95", overBudget: true, arriveBy: "Mar 6", store: "Amazon", reason: "Mentioned wanting good coffee." }];
      add("heads_up-over_budget", kind, { ...base, ideas: overBudget }, links);
      continue;
    }
    add(kind, kind, data, links);
    if (kind === "reminder") add("reminder-questions", kind, { ...SAMPLE_DATA.reminder.data, questions: 3 }, { ...links, questions: link });
    if (kind === "skipped") {
      add("skipped-held", kind, { ...SAMPLE_DATA.skipped.data, held: true }, links);
      const partial = { cancelled: ["Linen apron"], onItsWay: ["Le Creuset mug set"] };
      add("skipped-partial", kind, { ...SAMPLE_DATA.skipped.data, held: true, partial }, links);
    }
    if (kind === "failed_late") {
      add("failed_late-partial", kind, { ...SAMPLE_DATA.failed_late.data, onItsWay: ["Linen apron"] }, links);
      const two = [
        { title: "Le Creuset mug set", detail: "The price went up more than you allowed for." },
        { title: "Linen apron", detail: "The store ran out." },
      ];
      add("failed_late-several", kind, { ...SAMPLE_DATA.failed_late.data, failed: two, onItsWay: ["Cast-iron herb planter"] }, links);
    }
    if (kind === "no_ideas") add("no_ideas-again", kind, { ...SAMPLE_DATA.no_ideas.data, again: true }, links);
    if (kind === "hold_funds") {
      add("hold_funds-still", kind, { ...SAMPLE_DATA.hold_funds.data, still: true, placedTitle: "Linen apron" }, links);
    }
  }
  return list;
}

/** The Zinc wallet address and each failed gift's fix page, which some emails carry as data, point at `link` too. */
function withWallet(data: unknown, link: string): unknown {
  if (!data || typeof data !== "object") return data;
  let out = data;
  if ("walletUrl" in out) out = { ...out, walletUrl: link };
  if ("failed" in out && Array.isArray(out.failed)) {
    out = { ...out, failed: out.failed.map((f: object) => ("url" in f ? { ...f, url: link } : f)) };
  }
  return out;
}
