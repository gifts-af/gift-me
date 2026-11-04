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
  for (const kind of Object.keys(SAMPLE_DATA) as NotificationKind[]) {
    const { data, links } = SAMPLE_DATA[kind];
    const render = TEMPLATES[kind] as AnyTemplate;
    if (kind === "heads_up") {
      const base = SAMPLE_DATA.heads_up.data;
      const autoBuy = { ...base, mode: "auto_buy", autoBuyIdea: base.ideas[0].title, autoBuyDate: "Tuesday, March 10" };
      list.push({ name: "heads_up-reminder", email: render(base, linksTo(links, link)) });
      list.push({ name: "heads_up-auto_buy", email: render(autoBuy, { ...linksTo(links, link), skip: link }) });
    } else {
      list.push({ name: kind, email: render(data, linksTo(links, link)) });
      if (kind === "reminder") {
        const asked = { ...SAMPLE_DATA.reminder.data, questions: 3 };
        list.push({ name: "reminder-questions", email: render(asked, { ...linksTo(links, link), questions: link }) });
      }
    }
  }
  return list;
}
