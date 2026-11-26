import { APP_NAME, inboxFor } from "@/lib/brand";
import { type EmailRow, renderEmail } from "@/lib/email-layout";
import type { OutgoingEmail } from "@/lib/resend";
import { costLines } from "./costs";
import type { HealthReport, Problem, ProblemKind } from "./report";

/** Each kind's own heading under design/operations.md > Health email, never an existing section. */
export const RUNBOOK_ANCHORS: Record<ProblemKind, string> = {
  db_down: "the-database-cant-be-reached",
  tick_missed: "the-tick-didnt-finish",
  no_credit: "ai-credit",
  ideas_failed: "gift-ideas-failed",
  tick_failed: "the-tick-reported-failures",
  stuck_round: "stuck-rounds",
  unconfirmed: "order-unconfirmed",
  placing: "order-stuck-placing",
  held_zinc: "held-for-a-zinc-problem",
  ideas_not_configured: "ideas-cant-run-here",
  vendor_failed: "a-vendor-check-failed",
  credit_low: "ai-credit",
  zinc_low: "zinc-app-balance-low",
  deadline_close: "waiting-on-the-buyer",
  check_failed: "the-health-check-couldnt-run",
};

const TITLES: Record<ProblemKind, string> = {
  db_down: "The database can't be reached",
  tick_missed: "Today's round engine run didn't finish",
  no_credit: "Out of AI credit: ideas are paused",
  ideas_failed: "Gift ideas failed",
  tick_failed: "The tick reported failures",
  stuck_round: "A round is stuck",
  unconfirmed: "An order can't be confirmed",
  placing: "An order is stuck placing",
  held_zinc: "An order is held for a Zinc problem",
  ideas_not_configured: "Ideas can't run on this environment",
  vendor_failed: "A vendor check failed",
  credit_low: "AI credit is low",
  zinc_low: "The app's Zinc balance is low",
  deadline_close: "Waiting on the buyer, deadline close",
  check_failed: "The health check couldn't run",
};

const dollars = (n: unknown) => `$${(Number(n) / 100).toFixed(2)}`;
const utc = (iso: string) => {
  const t = new Date(iso).toISOString();
  return `${t.slice(0, 10)} ${t.slice(11, 16)} UTC`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function describe(p: Problem): string {
  const d = p.detail ?? {};
  const ids = p.ids
    ? [p.ids.roundId && `round ${p.ids.roundId}`, p.ids.orderId && `order ${p.ids.orderId}`, p.ids.userId && `user ${p.ids.userId}`]
        .filter(Boolean)
        .join(", ")
    : "";
  switch (p.kind) {
    case "tick_missed":
      return `Last successful finish: ${typeof d.lastOkFinishedAt === "string" ? utc(d.lastOkFinishedAt) : "none on record"}`;
    case "no_credit":
      return p.waiting?.length
        ? `Waiting on ideas: ${p.waiting.map((w) => `round ${w.roundId}`).join(", ")}`
        : "No round is waiting on ideas near its deadline";
    case "ideas_failed":
      return `${plural(Number(d.runs), "idea run", "idea runs")} failed in the last day`;
    case "vendor_failed":
      return `The ${d.vendor} balance couldn't be read`;
    case "tick_failed":
      return `${plural(Number(d.fanoutFailed), "fan-out send failed", "fan-out sends failed")}, ${plural(Number(d.roundsFailed), "round step failed", "round steps failed")}`;
    case "stuck_round":
      return `${ids}, ${plural(Number(d.attempts), "attempt", "attempts")}`;
    case "held_zinc":
      return `${ids}, hold reason ${d.holdReason}`;
    case "ideas_not_configured":
      return `Missing: ${d.missing}`;
    case "credit_low":
    case "zinc_low":
      return `${dollars(d.balanceCents)} left, warning below ${dollars(d.lowCents)}`;
    case "deadline_close":
      return `${ids}, waiting on ${d.reason}, ship by ${d.shipByDeadline}`;
    case "check_failed":
      return `Stopped at: ${d.stage}`;
    default:
      return ids;
  }
}

function weeklyLine(w: NonNullable<HealthReport["weekly"]>): string {
  return [
    `${w.waitingAddress} waiting on an address`,
    `${w.waitingFunds} waiting on funds`,
    `${w.waitingSetup} waiting on setup`,
    `${w.waitingApproval} waiting on approval`,
    `${w.noIdeas} ended with no ideas`,
    plural(w.roundsFailed, "round step failed", "round steps failed"),
    plural(w.failedCaptures, "failed capture", "failed captures"),
  ].join(", ");
}

function costRows(costs: HealthReport["costs"]): EmailRow[] {
  if (!costs) return [];
  if (costs === "unreadable") return [{ title: "Cost per completed gift", detail: "Costs couldn't be read" }];
  return costLines(costs);
}

const LAUNCH_LINES: [keyof Exclude<NonNullable<HealthReport["launch"]>, string>, string][] = [
  ["signups", "New signups"],
  ["listsStarted", "Started a list"],
  ["giftsAdded", "Gifts added"],
  ["listsFollowed", "Friends' lists saved"],
  ["giftsClaimed", "Gifts claimed"],
  ["peopleAdded", "People added"],
];

/** Last 24 hours, with the all-time count in brackets. Team and test accounts are left out (metrics_excluded). */
function launchRows(launch: HealthReport["launch"]): EmailRow[] {
  if (!launch) return [];
  if (launch === "unreadable") return [{ title: "Launch numbers", detail: "The numbers couldn't be read" }];
  return LAUNCH_LINES.map(([key, title]) => ({ title, detail: `${launch[key].day} in the last day (${launch[key].total} all time)` }));
}

/** One email to the owner inbox: each problem with its runbook link, and on the weekly day the counts and costs. */
export function buildHealthEmail(r: HealthReport, runbookBase: string): OutgoingEmail {
  const rows: EmailRow[] = r.problems.map((p) => ({
    title: TITLES[p.kind],
    detail: describe(p) || undefined,
    link: { label: "What to do", url: `${runbookBase}#${RUNBOOK_ANCHORS[p.kind]}` },
  }));
  rows.push(...costRows(r.costs));
  rows.push(...launchRows(r.launch));
  const paragraphs: string[] = [];
  if (r.problems.length === 0) paragraphs.push("Nothing needs you.");
  if (r.isWeekly && r.weekly) paragraphs.push(`This week: ${weeklyLine(r.weekly)}.`);

  const heading = r.problems.length === 0 ? "All clear" : `${plural(r.problems.length, "thing needs", "things need")} you`;
  const { html, text } = renderEmail({ heading, paragraphs, rows });
  return { to: inboxFor("health"), subject: `${APP_NAME} health: ${heading}`, html, text };
}
