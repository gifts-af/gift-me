import { EMAILED_HOLDS, nextAction, type ScheduleSettings, type StepKey } from "@gifts-af/core";
import { shortDate } from "@/lib/occasion-format";
import { errorFields, logEvent } from "@/lib/log";
import { notify, type NotifyResult } from "../notify/notify";
import { endedAddressReason, type CancelledGift, type FailedGift } from "../notify/templates";
import type { ClaimedRound, RoundContext, RoundOrder } from "./store";
import { chooseBy, fixPath, money, occasionWord, LIVE_HELD } from "./emails";
import type { EngineDeps } from "./engine";
import { dayOf, view, type Extra, sendStep, trySend } from "./steps";

// The money path (design §5.1): rounds with a held or failed gift. Tells the buyer and the
// list owner, retries placing, and closes the round at its deadline. See engine.ts for how a
// money-path round differs from an ordinary one.

/**
 * A round on the money path (ALL-32). Tells the buyer about a new hold or failure first,
 * then tries placing once, then sends whatever reminder is due; at the deadline it closes
 * the round with cancel_held. reconcile_round sets the status and the next look; the lease
 * goes back with release_round. Never finish_round (plan, rule 6).
 */
export async function runHeld(
  claimed: ClaimedRound,
  deps: EngineDeps,
  s: ScheduleSettings,
  justPlaced: boolean,
  placeBy: number,
): Promise<void> {
  const { store, now } = deps;
  const today = dayOf(now);
  const ids = { round_id: claimed.id, user_id: claimed.userId };
  let round = claimed;
  let placeTried = justPlaced;
  // At most one email to the buyer per run: after one goes out, only a try at placing may
  // follow, and anything else due waits for the next look (a hold starting a few days before
  // the deadline gets its notice today and the reminder tomorrow, not both at once).
  let emailed = false;
  const steps: string[] = [];
  // Ordering switched off outranks a funds hold for emailing (round-plan, orderingPaused).
  const orderingPaused = (await store.setting("zinc_ordering_enabled")) !== 1;
  // Failures the buyer hasn't heard about go first, in one email, whatever the round's reason
  // (ALL-116). Not part of "one email per run": each is news about a different gift. On the
  // deadline day the close tells them instead, in its own email.
  const atDeadline = round.shipByDeadline <= today;
  // A refusal isn't tried again this run; the next look does (one owner alert a look).
  let failuresRefused = false;
  const tellNow = async () => {
    if (atDeadline || failuresRefused) return;
    const told = await tellFailures(round, deps);
    if (told === "sent") steps.push("failures");
    failuresRefused = told === "refused";
  };
  await tellNow();
  // Each pass sends a new key or tries placing once, so this ends; the cap is a backstop.
  for (let pass = 0; pass < 5 && round.status === "needs_attention"; pass++) {
    const ctx = await store.roundContext(round.id);
    const sent = await store.sentSteps(round.id);
    const action = nextAction(view(round, ctx, sent, placeTried, orderingPaused), today, s);
    if (emailed && action.do !== "place") break;
    if (action.do === "skip") {
      steps.push(await closeAtDeadline(round, ctx, sent, deps, orderingPaused));
      break;
    }
    if (action.do === "place") {
      placeTried = true;
      steps.push("place");
      if (!deps.zinc) logEvent("zinc.wiring_missing", ids);
      // The run's placing budget is spent: the next tick tries it (the reminders still go today).
      else if ((deps.clock ?? Date.now)() >= placeBy) logEvent("order.place_budget_spent", ids);
      else await deps.zinc.placeRound(round.id, round.lockedUntil, placeBy, { address: round.attentionReason === "address" });
    } else if (action.do === "send_hold") {
      await sendStep(round, ctx, action.send, sent, deps);
      emailed = true;
      steps.push(action.send);
      const reason = round.attentionReason;
      if (action.send.startsWith("hold:") && reason && EMAILED_HOLDS.includes(reason)) {
        // What the buyer was told (reconcile rule 4), and the balance named in a funds email (AC-22).
        await store.markHoldEmailed(round.id, reason, reason === "funds" ? round.seenBalanceCents : null);
      }
      await store.reconcile(round.id);
    } else {
      break;
    }
    round = await store.refresh(round);
  }
  // A failure from this run's own placing is told now, not tomorrow (plan review S1).
  await tellNow();
  // Sets next_action_at for what's left (tomorrow, or the deadline once ordered).
  const status = await store.reconcile(round.id);
  if (!(await store.release(round.id, round.lockedUntil))) throw new Error("Lost the lease on the round");
  logEvent("round_step", { ...ids, status: claimed.status, next_status: status, step: steps.join(",") || null });
}

/**
 * The deadline for a held round (AC-23 to AC-25). cancel_held cancels what was never sent and
 * says where the round ends up. The buyer is always told, and an email the service refuses is
 * tried again on the next look, so the round isn't closed until the email that decides what
 * they hear has gone (owner):
 * - held gifts next to one placed, placing or unconfirmed: "we cancelled <gift>, nothing was
 *   charged" goes first, naming the other gift as on its way only once it's placed (a placing
 *   or unconfirmed one has its own emails);
 * - nothing placed, placing or unconfirmed: the skipped email (or missed_on_us when our own
 *   switch kept it back) goes first;
 * - still unconfirmed after closing: "still confirming". The round stays open, so a refusal is
 *   retried; when the cancel email went this run, it waits for the next look (one email a run).
 */
async function closeAtDeadline(
  round: ClaimedRound,
  ctx: RoundContext,
  sent: Set<StepKey>,
  deps: EngineDeps,
  orderingPaused: boolean,
): Promise<string> {
  const ids = { round_id: round.id, user_id: round.userId };
  const held = ctx.orders.filter(LIVE_HELD);
  const placed = ctx.orders.filter((o) => ["placed", "shipped", "delivered", "refunded"].includes(o.status));
  const pending = ctx.orders.some((o) => o.status === "placing" || o.status === "unconfirmed");
  // Our own switch kept it back: ordering is off now, whatever reason the hold was stored with
  // (gate_held_orders never replaces funds with paused), or the hold says paused.
  const skipStep: StepKey = round.attentionReason === "paused" || orderingPaused ? "missed_on_us" : "skipped";

  // Store cancels still open: a replaced one is resolved, and its replacement speaks for it.
  const unreplaced = ctx.orders.filter((o) => STORE_CANCELLED(o) && !o.resolved);
  let emailed = false;
  // The email that decides what the buyer hears goes before closing; a refusal keeps the round
  // open for the next look. Past the deadline that means a gift held open: alert the owner (once
  // a look, so once a day).
  const heldOpen = () => {
    if (dayOf(deps.now) > round.shipByDeadline) logEvent("round_deadline_email_held_open", { ...ids, alert: true });
  };
  const before = async (step: StepKey, extra: Extra = {}) => {
    try {
      await sendStep(round, ctx, step, sent, deps, extra);
    } catch (err) {
      heldOpen();
      throw err;
    }
  };
  // Failures the buyer hasn't heard about: one "We couldn't buy" email names them and any held
  // gift cancelled now, in place of the cancelled or skipped email (owner, 2026-11-08, ALL-116).
  if (ctx.orders.some((o) => isUntold(o, sent))) {
    const told = await tellClosing(round, held, orderingPaused, deps);
    if (told === "refused") {
      heldOpen();
      throw new Error("Sending the deadline's failure email failed");
    }
    emailed = told === "sent";
  }
  if (emailed) {
    // Told above.
  } else if (held.length > 0 && (placed.length > 0 || pending)) {
    const partial = { cancelled: held.map((o) => o.title), onItsWay: placed.map((o) => o.title) };
    await before("held_cancelled", { partial });
    emailed = true;
  } else if (placed.length === 0 && !pending && held.length === 0 && skipStep === "skipped" && unreplaced.length > 0) {
    // The store cancelled what was bought, and nothing replaced it: say so, not "No gift was
    // chosen" (owner, 2026-11-23). A refusal keeps the round open for the next look.
    if ((await tellStoreCancelled(round, ctx, unreplaced, deps)) === "refused") {
      heldOpen();
      throw new Error("Sending the deadline's store-cancelled email failed");
    }
    emailed = true;
  } else if (placed.length === 0 && !pending) {
    await before(skipStep);
    emailed = true;
  }

  const status = await deps.store.cancelHeld(round.id);
  // A failure the close found untold (one that arrived while we closed) goes to the late email,
  // which says what happened better than "skipped": send it now rather than at the next tick.
  const closed = await deps.store.roundContext(round.id);
  const late = closed.orders.some((o) => o.status === "failed" && o.failedAfterClose);
  // The store cancelled the last gift while we closed (it was placed when we looked): the round
  // ended skipped for that, so say so rather than "No gift was chosen". Only cancels never told
  // (no fail:<id>); best effort now the round is closed, and a refusal leaves it to the daily
  // news, which tells it once.
  const cancelledNow = status === "skipped" && !emailed && !late && skipStep === "skipped"
    ? closed.orders.filter((o) => STORE_CANCELLED(o) && !sent.has(`fail:${o.id}`))
    : [];
  if (cancelledNow.length > 0) await tellStoreCancelled(round, closed, cancelledNow, deps);
  if (late) {
    try {
      await tellOrdered(round.id, deps);
    } catch (err) {
      logEvent("order.failed_late_email_failed", { ...ids, ...errorFields(err), alert: true });
    }
  }
  // A placing order failed while we closed (rare), so the round ended skipped after all: the
  // skipped email still goes (its own key, so never twice), best effort now the round is closed,
  // unless the late email just told them what happened.
  if (status === "skipped" && (!emailed || pending) && !late && cancelledNow.length === 0) {
    if (!(await trySend(round, ctx, skipStep, sent, deps))) logEvent("round_skip_email_failed", { ...ids, alert: true });
  } else if (status === "needs_attention" && !emailed) {
    const after = await deps.store.refresh(round);
    if (after.attentionReason === "unconfirmed") {
      const step: StepKey = `hold:${after.holdCount}:deadline`;
      // A refusal is forgotten, and the round stays open, so the next day's look tries again.
      if (!(await trySend(after, ctx, step, sent, deps))) logEvent("round_hold_email_failed", ids);
    }
  }
  return `deadline:${status}`;
}

/**
 * The rounds with an order Zinc placed whose "ordered" email hasn't gone (a refused send is
 * forgotten): the tick sends them again, so the buyer is always told (owner).
 */
export async function retryOrderedEmails(deps: EngineDeps): Promise<void> {
  for (const roundId of await deps.store.roundsMissingOrderedEmail()) {
    try {
      await tellOrdered(roundId, deps);
    } catch (err) {
      logEvent("order.ordered_email_failed", { round_id: roundId, ...errorFields(err), alert: true });
    }
  }
}

/**
 * Asks a list owner to check their shared address after a store couldn't use it (ALL-112), at
 * most once per round, then clears what's left of the rejected address. The email says nothing
 * of a gift (decision 39). `refused`: there's an owner but the email didn't go; the tick tries
 * again until check_address_retry_days, then gives up and clears the address (T42). `retry`: a
 * failed lookup, which the tick also tries again.
 */
export async function tellOwnerOfRejection(roundId: string, deps: EngineDeps): Promise<"asked" | "ruled_out" | "refused" | "retry"> {
  const { store, now } = deps;
  const ids = { round_id: roundId };
  try {
    // First, because clearing the rejected address means there's no owner to find later on.
    const alreadyAsked = (await store.sentSteps(roundId)).has("shared_address");
    const owner = alreadyAsked ? null : await store.sharedAddressOwnerToTell(roundId);
    if (owner) {
      const { userId, orders } = await store.roundContext(roundId);
      // Read first: a blip after recording would lose the email for good.
      const [days, retryDays] = await Promise.all([store.setting("check_address_link_days"), store.setting("check_address_retry_days")]);
      // Another run has it, and may yet be refused: it stays on the to-do list, so nothing is cleared.
      if (!(await store.recordSend(roundId, userId, "shared_address"))) return "asked";
      const result = await notify(
        {
          userId: owner,
          kind: "check_your_address",
          data: {},
          links: { open: { action: "check_my_address", expiresAt: new Date(now.getTime() + days * 86_400_000) } },
        },
        deps.notify,
      );
      if (!result.ok) {
        await store.forgetSend(roundId, "shared_address");
        // When it failed, which nothing later moves (ALL-116), so the window never restarts.
        const rejectedAt = orders.find((o) => o.failureType === "address_rejected")?.failedAt;
        if (rejectedAt && now.getTime() - Date.parse(rejectedAt) > retryDays * 86_400_000) {
          await store.clearRejectedAddresses(roundId);
          logEvent("order.shared_address_notice_abandoned", { ...ids, alert: true });
        } else {
          logEvent("order.shared_address_notice_failed", { ...ids, alert: true });
        }
        return "refused";
      }
      logEvent("order.shared_address_notice", ids);
    }
    await store.clearRejectedAddresses(roundId);
    return alreadyAsked || owner ? "asked" : "ruled_out";
  } catch (err) {
    logEvent("order.shared_address_notice_failed", { ...ids, ...errorFields(err), alert: true });
    return "retry";
  }
}

/** For the tick: any round a run hasn't dealt with, including closed and cancelled ones. */
export async function tellOwnersOfRejections(deps: EngineDeps): Promise<void> {
  try {
    for (const roundId of await deps.store.roundsWithRejectedAddresses()) await tellOwnerOfRejection(roundId, deps);
  } catch (err) {
    logEvent("order.shared_address_notice_failed", { ...errorFields(err), alert: true });
  }
}

/**
 * The emails for orders Zinc settled (owner: customers are always told), each once, keyed in
 * round_sends so it never goes twice:
 * - "ordered" (PRD A-8) for each order Zinc confirmed placed, `ordered:<order id>`;
 * - "we couldn't buy it" (failed_late) for each order that failed after its round closed,
 *   `late_fail:<order id>`: the engine never looks at a closed round again (S2).
 * Called after a webhook or the sweep settles an order, and by the tick for any not yet sent.
 * A refusal is forgotten and logged for the owner.
 */
export async function tellOrdered(roundId: string, deps: EngineDeps): Promise<void> {
  const ctx = await deps.store.roundContext(roundId);
  const sent = await deps.store.sentSteps(roundId);
  const occasion = {
    personName: ctx.personName,
    occasion: occasionWord(ctx.occasionKind),
    dateText: shortDate(ctx.occasionDate),
  };
  const open = { action: "open_person" as const, expiresAt: new Date(`${ctx.occasionDate}T23:59:00Z`) };
  const placed = ctx.orders.filter((x) => ["placed", "shipped", "delivered"].includes(x.status));
  for (const o of placed) {
    const step: StepKey = `ordered:${o.id}`;
    if (sent.has(step)) continue;
    if (!(await deps.store.recordSend(roundId, ctx.userId, step))) continue;
    const result = await notify(
      {
        userId: ctx.userId,
        roundId,
        kind: "ordered",
        data: { ...occasion, giftTitle: o.title, ...(o.shipCity ? { cityText: o.shipCity } : {}) },
        links: { open },
      },
      deps.notify,
    );
    if (!result.ok) {
      await deps.store.forgetSend(roundId, step);
      logEvent("order.ordered_email_failed", { round_id: roundId, user_id: ctx.userId, order_id: o.id, alert: true });
    }
  }
  // Every late failure not yet told goes in one email (ALL-116). Only the keys this call recorded
  // are its own: another run that got some first sends those, and a refusal forgets only these.
  const fresh: RoundOrder[] = [];
  let result: NotifyResult;
  try {
    for (const o of ctx.orders.filter((x) => x.status === "failed" && x.failedAfterClose && !sent.has(`late_fail:${x.id}`))) {
      if (await deps.store.recordSend(roundId, ctx.userId, `late_fail:${o.id}`)) fresh.push(o);
    }
    if (fresh.length === 0) return;
    const onItsWay = placed.map((x) => x.title);
    result = await notify(
      {
        userId: ctx.userId,
        roundId,
        kind: "failed_late",
        data: {
          ...occasion,
          failed: fresh.map((o) => ({ title: o.title, detail: lateDetail(o, ctx.personName) })),
          ...(onItsWay.length > 0 ? { onItsWay } : {}),
          ...(ctx.closedEarly ? { closedEarly: true } : {}),
          ...(ctx.personRemoved ? { personRemoved: true } : {}),
        },
        links: { open },
      },
      deps.notify,
    );
  } catch (err) {
    // Never lose one (owner: always told): its keys go back and the tick tries again. A
    // database error just after the send could repeat it once; that beats never telling.
    for (const o of fresh) await deps.store.forgetSend(roundId, `late_fail:${o.id}`);
    throw err;
  }
  for (const o of fresh) {
    if (!result.ok) await deps.store.forgetSend(roundId, `late_fail:${o.id}`);
    const event = result.ok ? "order.failed_late_told" : "order.failed_late_email_failed";
    logEvent(event, { round_id: roundId, user_id: ctx.userId, order_id: o.id, ...(result.ok ? {} : { alert: true }) });
  }
}

// ─── Telling failures (ALL-116) ──────────────────────────────────────────────

/**
 * A failure the buyer hasn't heard about, as far as this run can tell. The database's
 * untold_failures (through claimFailureNotices) has the last word, including keys older code wrote.
 */
function isUntold(o: RoundOrder, sent: Set<StepKey>): boolean {
  return (
    o.status === "failed" &&
    !o.resolved &&
    !o.failedAfterClose &&
    o.failureType !== "invalid_shipping_address" &&
    !sent.has(`fail:${o.id}`)
  );
}

/** Why a gift failed, for a closed round: no choice left to offer. */
function lateDetail(o: RoundOrder, personName: string): string {
  switch (o.failureType) {
    case "price_up":
      return "The price went up more than you allowed for.";
    case "out_of_stock":
      return "The store ran out.";
    case "too_late":
      return "It wouldn't have arrived in time.";
    case "address_withdrawn":
      return `We couldn't use the address ${personName} was sharing.`;
    case "address_rejected":
      return `The store couldn't use the address ${personName} saved.`;
    case "store_cancelled":
      return "The store cancelled it, and the money is back in your Zinc wallet.";
    default:
      return "The store couldn't place the order.";
  }
}

/**
 * A store-cancelled gift for its emails: the store's name and the refund, each only when known
 * (what Zinc charged, else the most it could have).
 */
function cancelledGift(o: RoundOrder): CancelledGift {
  const cents = o.totalCents ?? o.maxPriceCents;
  return {
    title: o.title,
    ...(o.store ? { store: o.store.charAt(0).toUpperCase() + o.store.slice(1) } : {}),
    ...(cents > 0 ? { amountText: money(cents) } : {}),
  };
}

const STORE_CANCELLED = (o: RoundOrder) => o.status === "failed" && o.failureType === "store_cancelled";

/**
 * The store-cancelled email (owner, 2026-11-23), for a round ending skipped because the store
 * cancelled its gift: said in place of "No gift was chosen", and keyed `cancel_late:<id>` per
 * gift so the daily news never tells it again. Only the keys this call recorded are its own; a
 * refusal or an error gives them back. "none": another run told them all.
 */
async function tellStoreCancelled(
  round: ClaimedRound,
  ctx: RoundContext,
  cancelled: RoundOrder[],
  deps: EngineDeps,
): Promise<"sent" | "none" | "refused"> {
  const { store } = deps;
  const ids = { round_id: round.id, user_id: round.userId };
  const sent = await store.sentSteps(round.id);
  const fresh: RoundOrder[] = [];
  let result: NotifyResult;
  try {
    for (const o of cancelled.filter((x) => !sent.has(`cancel_late:${x.id}`))) {
      if (await store.recordSend(round.id, round.userId, `cancel_late:${o.id}`)) fresh.push(o);
    }
    if (fresh.length === 0) return "none";
    result = await notify(
      {
        userId: round.userId,
        roundId: round.id,
        kind: "store_cancelled_late",
        data: {
          personName: ctx.personName,
          occasion: occasionWord(ctx.occasionKind),
          dateText: shortDate(ctx.occasionDate),
          gifts: fresh.map(cancelledGift),
        },
        links: {},
      },
      deps.notify,
    );
  } catch (err) {
    logEvent("round_store_cancelled_email_failed", { ...ids, ...errorFields(err), alert: true });
    result = { ok: false, error: "threw" };
  }
  if (!result.ok) {
    for (const o of fresh) await store.forgetSend(round.id, `cancel_late:${o.id}`);
    if (result.error !== "threw") logEvent("round_store_cancelled_email_failed", { ...ids, alert: true });
    return "refused";
  }
  logEvent("round_store_cancelled_told", { ...ids, count: fresh.length });
  return "sent";
}

/** Why a gift failed and what the buyer can do now, for a summary while the round is open. */
function openRow(o: RoundOrder, personName: string, ownerAsked: boolean, url: string): FailedGift {
  const choose = `Choose another gift instead of the ${o.title}`;
  switch (o.failureType) {
    case "price_up":
      return {
        title: o.title,
        detail: "The price went up more than you allowed for. Approve the new price, or choose another gift.",
        action: `Review the new price for the ${o.title}`,
        url,
      };
    case "out_of_stock":
      return { title: o.title, detail: "The store ran out. Choose another gift.", action: choose, url };
    case "too_late":
      return { title: o.title, detail: "It wouldn't arrive in time anymore. Choose something that ships faster.", action: choose, url };
    case "store_cancelled":
      return { title: o.title, detail: `${lateDetail(o, personName)} Choose another gift.`, action: choose, url };
    case "address_withdrawn":
    case "address_rejected": {
      const asked = o.failureType === "address_rejected" && ownerAsked ? ` We'll ask ${personName} to check it, without mentioning a gift.` : "";
      return { title: o.title, detail: `${lateDetail(o, personName)}${asked} Choose another gift.`, action: choose, url };
    }
    default:
      return { title: o.title, detail: "The store couldn't place the order. Choose another gift.", action: choose, url };
  }
}

/**
 * Tells the round's untold failures while it's open, in one email: the gift's own email for one,
 * the summary for two or more. Keys are claimed under the round's lock first; a refusal gives
 * them back (and the run goes on, so a held gift is still tried). A crash after claiming keeps
 * them, so nothing is ever sent twice (AC-11).
 */
async function tellFailures(round: ClaimedRound, deps: EngineDeps): Promise<"sent" | "none" | "refused"> {
  const { store } = deps;
  const ids = { round_id: round.id, user_id: round.userId };
  let ctx = await store.roundContext(round.id);
  const sent = await store.sentSteps(round.id);
  const untold = ctx.orders.filter((o) => isUntold(o, sent));
  if (untold.length === 0) return "none";
  // The owner of a rejected shared address hears first, so the buyer's email can say so (ALL-112).
  let ownerAsked = false;
  if (untold.some((o) => o.failureType === "address_rejected")) {
    const told = await tellOwnerOfRejection(round.id, deps);
    ownerAsked = told === "asked" || told === "refused";
  }
  const claimed = await store.claimFailureNotices(round.id);
  if (claimed.length === 0) return "none";
  let failed: RoundOrder[] = [];
  let result: NotifyResult;
  try {
    ctx = await store.roundContext(round.id);
    failed = claimed.map((id) => ctx.orders.find((o) => o.id === id)).filter((o): o is RoundOrder => o !== undefined);
    result = await sendOpenFailures(round, ctx, failed, claimed, ownerAsked, deps);
  } catch (err) {
    // Never lose one (owner: always told): an error anywhere after the claim gives the keys
    // back. A database error just after the send could repeat it once; that beats never telling.
    await store.releaseFailureNotices(round.id, claimed);
    logEvent("round_failure_email_failed", { ...ids, ...errorFields(err), alert: true });
    return "refused";
  }
  if (!result.ok) {
    await store.releaseFailureNotices(round.id, claimed);
    logEvent("round_failure_email_failed", { ...ids, alert: true });
    return "refused";
  }
  logEvent("round_failures_told", { ...ids, count: failed.length });
  return "sent";
}

async function sendOpenFailures(
  round: ClaimedRound,
  ctx: RoundContext,
  failed: RoundOrder[],
  claimed: string[],
  ownerAsked: boolean,
  deps: EngineDeps,
): Promise<NotifyResult> {
  const base = { userId: round.userId, roundId: round.id };
  const occasion = { personName: ctx.personName, occasion: occasionWord(ctx.occasionKind), dateText: shortDate(ctx.occasionDate) };
  const open = { open: { action: "open_person" as const, expiresAt: new Date(`${round.shipByDeadline}T23:59:00Z`) } };
  // A single failure's button opens that gift's own fix page (ALL-29 AC-16); the page itself signs the buyer in.
  const fix = (o: RoundOrder) => ({ open: { path: fixPath(round.id, o.id) } });
  const orderByText = chooseBy(round.shipByDeadline);
  if (failed.length > 1) {
    // Gifts still in play before this news: not cancelled, and not a failure the buyer already heard about.
    const tried = new Set(
      ctx.orders.filter((o) => o.status !== "cancelled" && !(o.status === "failed" && !claimed.includes(o.id))).map((o) => o.ideaId),
    ).size;
    const onItsWay = ctx.orders.filter((o) => ["placed", "shipped", "delivered"].includes(o.status)).map((o) => o.title);
    return notify(
      {
        ...base,
        kind: "failed_several",
        data: {
          ...occasion,
          tried: Math.max(tried, failed.length),
          failed: failed.map((o) => openRow(o, ctx.personName, ownerAsked, `${deps.notify.baseUrl}${fixPath(round.id, o.id)}`)),
          ...(onItsWay.length > 0 ? { onItsWay } : {}),
          orderByText,
        },
        links: open,
      },
      deps.notify,
    );
  }
  const [o] = failed;
  const one = { ...occasion, giftTitle: o.title, orderByText };
  switch (o.failureType) {
    case "price_up":
      return notify({ ...base, kind: "price_up", data: one, links: fix(o) }, deps.notify);
    case "out_of_stock":
      return notify({ ...base, kind: "out_of_stock", data: one, links: fix(o) }, deps.notify);
    case "too_late":
      return notify({ ...base, kind: "too_late", data: one, links: fix(o) }, deps.notify);
    case "address_withdrawn":
    case "address_rejected": {
      const reason = endedAddressReason(o.failureType, ctx.personName, [o.title], ownerAsked);
      return notify({ ...base, kind: "needs_attention", data: { ...occasion, reason, orderByText }, links: fix(o) }, deps.notify);
    }
    case "store_cancelled": {
      const g = cancelledGift(o);
      const reason = `${g.store ?? "the store"} cancelled the ${o.title}, and the ${g.amountText ?? "money"} is back in your Zinc wallet.`;
      return notify({ ...base, kind: "needs_attention", data: { ...occasion, reason, orderByText }, links: fix(o) }, deps.notify);
    }
    default: {
      const reason = `the store couldn't place the order for the ${o.title}, and you haven't been charged.`;
      return notify({ ...base, kind: "needs_attention", data: { ...occasion, reason, orderByText }, links: fix(o) }, deps.notify);
    }
  }
}

/**
 * The deadline with untold failures (owner, 2026-11-08): before the round closes, one "We
 * couldn't buy" email names them and any held gift cancelled now, in place of the cancelled
 * or skipped email. "none": another run got them first.
 */
async function tellClosing(
  round: ClaimedRound,
  held: RoundOrder[],
  orderingPaused: boolean,
  deps: EngineDeps,
): Promise<"sent" | "none" | "refused"> {
  const { store } = deps;
  const ids = { round_id: round.id, user_id: round.userId };
  const claimed = await store.claimFailureNotices(round.id);
  if (claimed.length === 0) return "none";
  let heldToo = false;
  let failed: RoundOrder[] = [];
  let result: NotifyResult;
  try {
    // The held gifts are named here only if the cancelled email hasn't gone.
    heldToo = held.length > 0 && (await store.recordSend(round.id, round.userId, "held_cancelled"));
    const ctx = await store.roundContext(round.id);
    failed = claimed.map((id) => ctx.orders.find((o) => o.id === id)).filter((o): o is RoundOrder => o !== undefined);
    const rows = [
      ...failed.map((o) => ({ title: o.title, detail: lateDetail(o, ctx.personName) })),
      ...(heldToo ? held.map((o) => ({ title: o.title, detail: heldDetail(o, orderingPaused) })) : []),
    ];
    const onItsWay = ctx.orders.filter((o) => ["placed", "shipped", "delivered"].includes(o.status)).map((o) => o.title);
    result = await notify(
      {
        userId: round.userId,
        roundId: round.id,
        kind: "failed_late",
        data: {
          personName: ctx.personName,
          occasion: occasionWord(ctx.occasionKind),
          dateText: shortDate(ctx.occasionDate),
          failed: rows,
          ...(onItsWay.length > 0 ? { onItsWay } : {}),
          ...(ctx.personRemoved ? { personRemoved: true } : {}),
        },
        links: { open: { action: "open_person", expiresAt: new Date(`${ctx.occasionDate}T23:59:00Z`) } },
      },
      deps.notify,
    );
  } catch (err) {
    // A database error just after the send could repeat it once; that beats never telling.
    logEvent("round_failure_email_failed", { ...ids, ...errorFields(err), alert: true });
    result = { ok: false, error: "threw" };
  }
  if (!result.ok) {
    // Never lose one: the keys go back and the round stays open for the next look.
    await store.releaseFailureNotices(round.id, claimed);
    if (heldToo) await store.forgetSend(round.id, "held_cancelled");
    if (result.error !== "threw") logEvent("round_failure_email_failed", { ...ids, alert: true });
    return "refused";
  }
  logEvent("round_failures_told", { ...ids, count: failed.length });
  return "sent";
}

/** Why a held gift was cancelled at the deadline, for the closing summary (plan review S4). */
function heldDetail(o: RoundOrder, orderingPaused: boolean): string {
  if (orderingPaused || o.holdReason === "paused") {
    return "A problem on our side stopped us ordering it in time. That's on us, and we're sorry.";
  }
  switch (o.holdReason) {
    case "funds":
      return "There wasn't enough in your Zinc balance in time, so we cancelled it.";
    case "setup":
      return "Payment wasn't set up in time, so we cancelled it.";
    case "address":
      return "We didn't have an address we could ship to in time, so we cancelled it.";
    default:
      return "It couldn't be bought in time, so we cancelled it.";
  }
}
