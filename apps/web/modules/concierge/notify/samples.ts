import { buildHealthEmail } from "../health/email";
import { checkFailedReport, type HealthReport, type Problem } from "../health/report";
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
      add("heads_up-restored", kind, { ...base, restored: "none" }, links);
      add("heads_up-restored_failed", kind, { ...base, restored: "failed" }, links);
      continue;
    }
    add(kind, kind, data, links);
    if (kind === "reminder") add("reminder-questions", kind, { ...SAMPLE_DATA.reminder.data, questions: 3 }, { ...links, questions: link });
    if (kind === "skipped") {
      add("skipped-held", kind, { ...SAMPLE_DATA.skipped.data, held: true }, links);
      const partial = { cancelled: ["Linen apron"], onItsWay: ["Le Creuset mug set"], coming: true };
      add("skipped-partial", kind, { ...SAMPLE_DATA.skipped.data, held: true, partial }, links);
    }
    if (kind === "out_of_stock") add("out_of_stock-partial", kind, { ...SAMPLE_DATA.out_of_stock.data, ordering: ["Linen apron"] }, links);
    if (kind === "failed_late") {
      add("failed_late-partial", kind, { ...SAMPLE_DATA.failed_late.data, onItsWay: ["Linen apron"] }, links);
      const two = [
        { title: "Le Creuset mug set", detail: "The price went up more than you allowed for." },
        { title: "Linen apron", detail: "The store ran out." },
      ];
      add("failed_late-several", kind, { ...SAMPLE_DATA.failed_late.data, failed: two, onItsWay: ["Cast-iron herb planter"] }, links);
    }
    if (kind === "reaction_prompt") {
      const [first] = SAMPLE_DATA.reaction_prompt.data.rounds;
      const dad = { personName: "Dad", occasion: "anniversary", dateText: "Monday, March 16", gifts: [{ title: "Tea sampler" }] };
      const third = { loved2: link, liked2: link, meh2: link, returned2: link };
      add("reaction_prompt-several", kind, { rounds: [first, dad] }, { ...links, ...third });
    }
    if (kind === "no_ideas") {
      add("no_ideas-again", kind, { ...SAMPLE_DATA.no_ideas.data, again: true }, links);
      add("no_ideas-spent", kind, { ...SAMPLE_DATA.no_ideas.data, spent: true }, links);
      add("no_ideas-too_late", kind, { ...SAMPLE_DATA.no_ideas.data, tooLate: true }, {});
    }
    if (kind === "hold_funds") {
      add("hold_funds-still", kind, { ...SAMPLE_DATA.hold_funds.data, still: true, placedTitle: "Linen apron" }, links);
    }
  }
  list.push(...healthSamples(link));
  return list;
}

// The owner's health emails: every problem kind once, the Monday all-clear, and a check that couldn't run. Their
// runbook links lose their section anchor so they point at `link` like every other sample's buttons.
function healthSamples(link: string): SampleEmail[] {
  const id = (n: string) => `00000000-0000-0000-0000-${n.padStart(12, "0")}`;
  const ref = (n: string) => ({ roundId: id(n), userId: id("1") });
  const problems: Problem[] = [
    { kind: "db_down" },
    { kind: "tick_missed", detail: { lastOkFinishedAt: "2026-03-09T10:04:00Z" } },
    { kind: "no_credit", detail: { noCreditRuns: 1 }, waiting: [{ roundId: id("2"), userId: id("1"), shipByDeadline: "2026-03-12" }] },
    { kind: "ideas_failed", detail: { runs: 2 } },
    { kind: "tick_failed", detail: { roundsFailed: 2, fanoutFailed: 1 } },
    { kind: "stuck_round", ids: ref("3"), detail: { attempts: 3 } },
    { kind: "unconfirmed", ids: { ...ref("4"), orderId: id("40") } },
    { kind: "placing", ids: { ...ref("5"), orderId: id("50") } },
    { kind: "held_zinc", ids: { ...ref("6"), orderId: id("60") }, detail: { holdReason: "retry" } },
    { kind: "ideas_not_configured", detail: { missing: "AI Gateway" } },
    { kind: "vendor_failed", detail: { vendor: "AI Gateway" } },
    { kind: "credit_low", detail: { balanceCents: 320, lowCents: 500 } },
    { kind: "zinc_low", detail: { balanceCents: 210, lowCents: 500 } },
    { kind: "deadline_close", ids: ref("7"), detail: { reason: "address", shipByDeadline: "2026-03-14" } },
  ];
  const weekly = { waitingAddress: 1, waitingFunds: 1, waitingSetup: 0, waitingApproval: 2, noIdeas: 0, roundsFailed: 0, failedCaptures: 1 };
  const costs: HealthReport["costs"] = {
    since: "2025-12-11T14:00:00.000Z",
    windowDays: 90,
    gifts: 12,
    aiCents: 372,
    lookupCents: 252,
    aiRecords: 41,
    aiEstimated: 2,
    bills: [
      { month: "2026-01-01", vendors: ["Resend", "domain"] },
      { month: "2026-02-01", vendors: ["Resend", "domain"] },
    ],
    billCents: 500,
    billGifts: 6,
    orderFeeCents: 100,
    excludedCents: 42,
  };
  const render = (name: string, report: HealthReport): SampleEmail => {
    const { subject, html, text } = buildHealthEmail(report, link);
    const plain = (s: string) => s.split(`${link}#`).map((part, n) => (n === 0 ? part : part.replace(/^[a-z-]+/, ""))).join(link);
    return { name, email: { subject, html: plain(html ?? ""), text: plain(text) } };
  };
  return [
    render("health-problems", { problems, weekly, isWeekly: true, costs }),
    render("health-weekly-all-clear", { problems: [], weekly, isWeekly: true, costs }),
    render("health-check-failed", checkFailedReport("snapshot")),
  ];
}

/** The Zinc wallet address, each failed gift's fix page and each news row's link, which some emails carry as data, point at `link` too. */
function withWallet(data: unknown, link: string): unknown {
  if (!data || typeof data !== "object") return data;
  let out = data;
  if ("walletUrl" in out) out = { ...out, walletUrl: link };
  if ("failed" in out && Array.isArray(out.failed)) {
    out = { ...out, failed: out.failed.map((f: object) => ("url" in f ? { ...f, url: link } : f)) };
  }
  // The daily news summary's "It already arrived" links (ALL-33).
  if ("items" in out && Array.isArray(out.items)) {
    out = { ...out, items: out.items.map((i: object) => ("url" in i ? { ...i, url: link } : i)) };
  }
  return out;
}
