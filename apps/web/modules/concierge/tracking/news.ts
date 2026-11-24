import { daysBetween, expectedArrival, trackingNews, type CalendarDate, type StepKey } from "@gifts-af/core";
import { shortDate } from "@/lib/occasion-format";
import { errorFields, logEvent } from "@/lib/log";
import { storeLabel } from "@/lib/store-label";
import { notify, type NotifyDeps, type NotifyResult } from "../notify/notify";
import type { NewsItem } from "../notify/templates";
import { money, occasionWord } from "../rounds/emails";
import type { RoundStore, TrackingCandidate } from "../rounds/store";

// The daily tracking news (ALL-33): one email per buyer per day with every gift that's newly late,
// back on time, or cancelled by the store too late to ship another. Bad news first. One item is
// told with that item's own email. Every change of a gift's timing is told. Each item is claimed once
// in round_sends (`late:`, `ontime:`, `late:2:`, ... and `cancel_late:<order id>`), the same keys the deadline close-out claims for store cancels, so
// whichever runs first tells it and the other skips it.

export type TrackingNewsDeps = {
  store: RoundStore;
  notify: NotifyDeps;
  /** The run's UTC calendar day. */
  today: CalendarDate;
  setting: (key: string) => Promise<number>;
};

type Item = { c: TrackingCandidate; step: StepKey; news: "late" | "cancelled" | "on_time"; expected?: CalendarDate; again?: boolean };

const ORDER: Item["news"][] = ["late", "cancelled", "on_time"];

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Bad news first (late, then cancelled, then on time), then by occasion date, person, gift and
 * order id. tracking_candidates has no order of its own, so without the tie-breaks two late gifts
 * could swap places from one run to the next.
 */
const byNews = (a: Item, b: Item) =>
  ORDER.indexOf(a.news) - ORDER.indexOf(b.news) ||
  cmp(a.c.occasionDate, b.c.occasionDate) ||
  cmp(a.c.personName, b.c.personName) ||
  cmp(a.c.title, b.c.title) ||
  cmp(a.c.orderId, b.c.orderId);

const roundPath = (roundId: string) => `/rounds/${roundId}`;

export async function runTrackingNews(deps: TrackingNewsDeps): Promise<{ sent: number }> {
  const items = await newsItems(deps);
  const byUser = new Map<string, Item[]>();
  for (const it of items) byUser.set(it.c.userId, [...(byUser.get(it.c.userId) ?? []), it]);
  let sent = 0;
  for (const [userId, list] of byUser) {
    if (await tellUser(userId, list, deps)) sent++;
  }
  return { sent };
}

/** The key for the nth time: `late:<id>`, then `late:2:<id>`, ... */
const nthKey = (c: TrackingCandidate, kind: "late" | "ontime", n: number): StepKey => (n === 1 ? `${kind}:${c.orderId}` : `${kind}:${n}:${c.orderId}`);

/** The newest number told of this kind; 0 when never. The newest, not a count, so a missing key can't mute the gift. */
function newest(c: TrackingCandidate, kind: "late" | "ontime"): number {
  let last = 0;
  for (const step of c.sentSteps) {
    const [k, ...rest] = step.split(":");
    if (k !== kind || rest.at(-1) !== c.orderId) continue;
    last = Math.max(last, rest.length === 1 ? 1 : Number(rest[0]));
  }
  return last;
}

/**
 * What each candidate has to tell. A store cancel is always told (money came back); the late
 * check has its own switch, read only when there's a placed or shipped gift to check, so a
 * missing setting can't hold back cancel news.
 */
async function newsItems(deps: TrackingNewsDeps): Promise<Item[]> {
  const items: Item[] = [];
  let lateCheck: boolean | undefined;
  for (const c of await deps.store.trackingCandidates(deps.today)) {
    const ids = { user_id: c.userId, round_id: c.roundId, order_id: c.orderId };
    if (c.status === "failed") {
      if (c.failureType === "store_cancelled" && c.resolved) items.push({ c, step: `cancel_late:${c.orderId}`, news: "cancelled" });
      continue;
    }
    if (lateCheck === undefined) {
      try {
        lateCheck = (await deps.setting("late_check_enabled")) === 1;
      } catch (err) {
        logEvent("tracking.late_check_unreadable", { ...errorFields(err) });
        lateCheck = false;
      }
    }
    if (!lateCheck) continue;
    const expected = expectedArrival(c);
    if (!expected) {
      logEvent("tracking.no_expected_date", ids);
      continue;
    }
    const [lastLate, lastOnTime] = [newest(c, "late"), newest(c, "ontime")];
    const news = trackingNews({ expected: expected.date, occasionDate: c.occasionDate, today: deps.today, lastLate, lastOnTime });
    if (news === "late") {
      const n = lastOnTime + 1;
      items.push({ c, step: nthKey(c, "late", n), news: "late", expected: expected.date, again: n > 1 });
    }
    if (news === "on_time") items.push({ c, step: nthKey(c, "ontime", lastLate), news: "on_time", expected: expected.date });
  }
  return items;
}

/**
 * Claims the user's items and tells the ones this run claimed, in one email. A refused or failed
 * send gives back every key it claimed, across rounds, so the next run tries again (like
 * release_failure_notices). True when an email went out.
 */
async function tellUser(userId: string, list: Item[], deps: TrackingNewsDeps): Promise<boolean> {
  const claimed: Item[] = [];
  let result: NotifyResult;
  try {
    for (const it of list) {
      if (await deps.store.recordSend(it.c.roundId, userId, it.step)) claimed.push(it);
    }
    if (claimed.length === 0) return false;
    claimed.sort(byNews);
    result = await send(userId, claimed, deps);
  } catch (err) {
    logEvent("tracking.news_failed", { user_id: userId, ...errorFields(err), alert: true });
    result = { ok: false, error: "threw" };
  }
  if (result.ok) {
    logEvent("tracking.news_sent", { user_id: userId, items: claimed.length });
    return true;
  }
  try {
    for (const it of claimed) await deps.store.forgetSend(it.c.roundId, it.step);
  } catch (err) {
    logEvent("tracking.news_release_failed", { user_id: userId, ...errorFields(err), alert: true });
  }
  if (result.error !== "threw") logEvent("tracking.news_failed", { user_id: userId, alert: true });
  return false;
}

function occasion(c: TrackingCandidate) {
  return { personName: c.personName, occasion: occasionWord(c.occasionKind), dateText: shortDate(c.occasionDate) };
}

// Zinc's own refund amount, never what we were charged: when Zinc didn't say, no amount is said.
const amountText = (c: TrackingCandidate) => (c.refundCents !== null && c.refundCents > 0 ? { amountText: money(c.refundCents) } : {});

function send(userId: string, items: Item[], deps: TrackingNewsDeps): Promise<NotifyResult> {
  const rounds = new Set(items.map((i) => i.c.roundId));
  const base = { userId, ...(rounds.size === 1 ? { roundId: items[0].c.roundId } : {}) };
  if (items.length === 1) {
    const [{ c, news, expected, again }] = items;
    if (news === "cancelled") {
      const store = c.store ? { store: storeLabel(c.store)! } : {};
      return notify(
        { ...base, kind: "store_cancelled_late", data: { ...occasion(c), gifts: [{ title: c.title, ...store, ...amountText(c) }] }, links: {} },
        deps.notify,
      );
    }
    const gift = { ...occasion(c), giftTitle: c.title, expectedText: shortDate(expected!) };
    if (news === "late") {
      return notify(
        {
          ...base,
          kind: "gift_late",
          data: { ...gift, daysLate: daysBetween(c.occasionDate, expected!), ...(again ? { again } : {}) },
          // "It already arrived" only for a shipped gift: a placed one can't be marked arrived.
          links: c.status === "shipped" ? { arrived: { path: roundPath(c.roundId) } } : {},
        },
        deps.notify,
      );
    }
    return notify({ ...base, kind: "gift_on_time", data: gift, links: { open: { path: roundPath(c.roundId) } } }, deps.notify);
  }
  return notify({ ...base, kind: "tracking_news", data: { items: items.map((i) => newsItem(i, deps.notify.baseUrl)) }, links: {} }, deps.notify);
}

function newsItem({ c, news, expected, again }: Item, baseUrl: string): NewsItem {
  const common = { ...occasion(c), title: c.title };
  if (news === "cancelled") return { kind: "cancelled", ...common, ...amountText(c) };
  const expectedText = shortDate(expected!);
  if (news === "on_time") return { kind: "on_time", ...common, expectedText };
  return {
    kind: "late",
    ...common,
    expectedText,
    daysLate: daysBetween(c.occasionDate, expected!),
    ...(again ? { again } : {}),
    ...(c.status === "shipped" ? { url: `${baseUrl}${roundPath(c.roundId)}` } : {}),
  };
}
