import { compareDates, type AttentionReason, type CalendarDate, type OccasionKind, type RoundStatus, type ScheduleSettings, type StepKey } from "@gifts-af/core";
import type {
  Candidate,
  ClaimedRound,
  NewRoundRow,
  ReactionAsk,
  RoundContext,
  RoundFinish,
  RoundStore,
} from "../rounds/store";

export type FakeRound = Omit<NewRoundRow, "nextActionAt"> & {
  id: string;
  status: RoundStatus;
  nextActionAt: Date | null;
  headsUpOn: CalendarDate | null;
  lockedUntil: Date | null;
  attempts: number;
  /** Every status the round has had, oldest first. */
  history: RoundStatus[];
  /** A needs_attention round's reason (ALL-125 tests); null when left out. */
  attentionReason?: AttentionReason | null;
};

export type FakePerson = { name: string; hasAddress: boolean; openQuestions?: number };

/** round_idea_state for one round, and whether a run started after its no_ideas email (ALL-27). */
export type FakeIdeaState = {
  hasFacts: boolean;
  hasListGifts: boolean;
  ideaRunsLeft: boolean;
  ranSinceNoIdeas: boolean;
  waitingOnCredit: boolean;
  paid: boolean;
  ideaEngineOn: boolean;
};

const FINISHED: RoundStatus[] = ["complete", "skipped", "ordered", "delivered"];

/**
 * An in-memory RoundStore that behaves like the SQL functions: claims take a
 * lease of `round_lock_minutes` and count an attempt, finish needs the exact
 * lease, and a send is recorded once per round and step. Every write is
 * logged in `writes`, so a test can assert that nothing changed.
 */
export class FakeRoundStore implements RoundStore {
  settings = new Map<string, number>();
  schedule!: ScheduleSettings;
  candidateRows: Candidate[] = [];
  people = new Map<string, FakePerson>();
  occasionKinds = new Map<string, OccasionKind>();
  rounds: FakeRound[] = [];
  sends = new Map<string, Set<StepKey>>();
  ideas = new Map<string, { id?: string; title: string; totalCents: number; arriveBy?: string | null; reason?: string | null; store?: string; fromList?: boolean; overBudget?: boolean }[]>();
  /** Per round; a round not in here has facts and runs left. */
  ideaState = new Map<string, Partial<FakeIdeaState>>();
  writes: string[] = [];

  async setting(key: string) {
    const v = this.settings.get(key);
    if (v === undefined) throw new Error(`No setting ${key}`);
    return v;
  }

  async scheduleSettings() {
    return this.schedule;
  }

  async candidates() {
    return this.candidateRows;
  }

  async insertRound(r: NewRoundRow) {
    const exists = this.rounds.some(
      (x) => x.personId === r.personId && x.occasionId === r.occasionId && x.occasionYear === r.occasionYear,
    );
    if (exists) return false;
    this.writes.push("insertRound");
    this.rounds.push({
      ...r,
      id: `round-${this.rounds.length + 1}`,
      status: "scheduled",
      headsUpOn: null,
      lockedUntil: null,
      attempts: 0,
      history: ["scheduled"],
    });
    return true;
  }

  round(id: string): FakeRound {
    const r = this.rounds.find((x) => x.id === id);
    if (!r) throw new Error(`No round ${id}`);
    return r;
  }

  private claimable(r: FakeRound, now: Date) {
    return (
      r.nextActionAt !== null &&
      r.nextActionAt.getTime() <= now.getTime() &&
      !FINISHED.includes(r.status) &&
      (r.lockedUntil === null || r.lockedUntil.getTime() < now.getTime())
    );
  }

  // Check and set with no await in between, like the SQL update.
  private take(r: FakeRound, now: Date, lockMinutes: number): ClaimedRound {
    this.writes.push(`claim:${r.id}`);
    r.lockedUntil = new Date(now.getTime() + lockMinutes * 60_000);
    r.attempts += 1;
    return {
      id: r.id,
      userId: r.userId,
      personId: r.personId,
      status: r.status,
      shipByDeadline: r.shipByDeadline,
      headsUpOn: r.headsUpOn,
      late: r.late,
      attempts: r.attempts,
      lockedUntil: new Date(r.lockedUntil.getTime()),
      attentionReason: r.attentionReason ?? null,
      holdCount: 0,
      seenBalanceCents: null,
      emailedBalanceCents: null,
    };
  }

  async claimDue(now: Date) {
    const minutes = await this.setting("round_lock_minutes");
    return this.rounds
      .filter((r) => this.claimable(r, now))
      .sort((a, b) => a.nextActionAt!.getTime() - b.nextActionAt!.getTime())
      .map((r) => this.take(r, now, minutes));
  }

  /** Like due_rounds: due at `now`, unleased, not finished; held (needs_attention) first, then by deadline. Claims nothing. */
  async dueRounds(now: Date) {
    const held = (r: FakeRound) => (r.status === "needs_attention" ? 0 : 1);
    return this.rounds
      .filter((r) => this.claimable(r, now))
      .sort((a, b) => held(a) - held(b) || compareDates(a.shipByDeadline, b.shipByDeadline) || a.nextActionAt!.getTime() - b.nextActionAt!.getTime())
      .map((r) => ({ id: r.id, userId: r.userId, status: r.status, attentionReason: null, shipByDeadline: r.shipByDeadline }));
  }

  /** Like claim_due_money_rounds: only due needs_attention rounds (none reach it in this fake). */
  async claimDueMoney(now: Date) {
    const minutes = await this.setting("round_lock_minutes");
    return this.rounds
      .filter((r) => r.status === "needs_attention" && this.claimable(r, now))
      .map((r) => this.take(r, now, minutes));
  }

  async claim(roundId: string, now: Date) {
    const minutes = await this.setting("round_lock_minutes");
    const r = this.rounds.find((x) => x.id === roundId);
    return r && this.claimable(r, now) ? this.take(r, now, minutes) : null;
  }

  /** Like claim_round_now: ignores nextActionAt, only awaiting_approval or needs_attention. */
  async claimNow(roundId: string, now: Date) {
    const minutes = await this.setting("round_lock_minutes");
    const r = this.rounds.find((x) => x.id === roundId);
    const open = r && ["awaiting_approval", "needs_attention"].includes(r.status);
    const free = r && (r.lockedUntil === null || r.lockedUntil.getTime() < now.getTime());
    return r && open && free ? this.take(r, now, minutes) : null;
  }

  async finish(roundId: string, lock: Date, next: RoundFinish) {
    const r = this.round(roundId);
    if (r.lockedUntil?.getTime() !== lock.getTime()) return false;
    this.writes.push(`finish:${roundId}:${next.status}`);
    if (r.status !== next.status) r.history.push(next.status);
    r.status = next.status;
    r.nextActionAt = next.nextActionAt;
    if (next.headsUpOn) r.headsUpOn = next.headsUpOn;
    r.lockedUntil = null;
    r.attempts = 0;
    return true;
  }

  /**
   * What reject_round_ideas does with a new search left (ALL-29 AC-12, AC-13): the ideas go, the
   * sent approval emails become `<step>@<n>`, and the round is back to generating, due now.
   * heads_up_on stays, as in SQL; the next heads-up sets it again.
   */
  reject(roundId: string, now: Date) {
    const r = this.round(roundId);
    const steps = ["heads_up", "reminder_1", "reminder_2", "final_notice", "no_ideas", "no_ideas_again"];
    const sent = this.sends.get(roundId) ?? new Set<StepKey>();
    const n = 1 + Math.max(0, ...[...sent].map((k) => /^([a-z_0-9]+)@(\d+)$/.exec(k)).filter((m) => m && steps.includes(m[1])).map((m) => Number(m![2])));
    this.sends.set(roundId, new Set([...sent].map((k) => (steps.includes(k) ? (`${k}@${n}` as StepKey) : k))));
    this.ideas.delete(roundId);
    this.writes.push(`reject:${roundId}`);
    if (r.status !== "generating") r.history.push("generating");
    r.status = "generating";
    r.nextActionAt = now;
  }

  /** Like restore_rejected_ideas in a round that was never rejected: none come back (no-new-ideas-db.test.ts has the real one). */
  async restoreRejected() {
    return { count: 0, outcome: null };
  }

  /** What the database does when the occasion's date moves (handle_occasion_moved). */
  moved = new Set<string>();
  endByMove(roundId: string) {
    const r = this.round(roundId);
    this.moved.add(roundId);
    r.status = "skipped";
    r.history.push("skipped");
    r.nextActionAt = null;
    r.lockedUntil = null;
  }
  async holdsLease(roundId: string, lock: Date) {
    return this.round(roundId).lockedUntil?.getTime() === lock.getTime();
  }
  async endedByMove(roundId: string) {
    return this.moved.has(roundId);
  }

  /** The fake records a send only with its email, so the key stands for both. */
  async lateEmailSent(roundId: string) {
    return this.sends.get(roundId)?.has("no_ideas_late") ?? false;
  }

  async sentSteps(roundId: string) {
    return new Set(this.sends.get(roundId));
  }

  async recordSend(roundId: string, _userId: string, step: StepKey) {
    const set = this.sends.get(roundId) ?? new Set<StepKey>();
    if (set.has(step)) return false;
    this.writes.push(`recordSend:${roundId}:${step}`);
    set.add(step);
    this.sends.set(roundId, set);
    return true;
  }

  async roundsWithRejectedAddresses(): Promise<string[]> {
    return [];
  }

  async sharedAddressOwnerToTell(roundId: string): Promise<string | null> {
    void roundId;
    return null;
  }

  async clearRejectedAddresses(): Promise<void> {}

  async forgetSend(roundId: string, step: StepKey) {
    this.writes.push(`forgetSend:${roundId}:${step}`);
    this.sends.get(roundId)?.delete(step);
  }

  async roundContext(roundId: string): Promise<RoundContext> {
    const r = this.round(roundId);
    const person = this.people.get(r.personId);
    const kind = this.occasionKinds.get(r.occasionId);
    if (!person || !kind) throw new Error(`Round ${roundId} has no person or occasion`);
    return {
      userId: r.userId,
      personId: r.personId,
      personName: person.name,
      occasionKind: kind,
      occasionDate: r.occasionDate,
      shipByDeadline: r.shipByDeadline,
      hasAddress: person.hasAddress,
      hasSharedAddress: false,
      openQuestions: person.openQuestions ?? 0,
      ideas: (this.ideas.get(roundId) ?? []).map((i, n) => ({
        ...i,
        id: i.id ?? `${roundId}-idea-${n + 1}`,
        arriveBy: i.arriveBy ?? null,
        reason: i.reason ?? null,
        store: i.store ?? null,
        fromList: i.fromList ?? false,
        overBudget: i.overBudget ?? false,
      })),
      hasFacts: true,
      hasListGifts: false,
      restored: null,
      ideaRunsLeft: true,
      ideaRunsSpent: false,
      ranIdeas: false,
      ranSinceNoIdeas: false,
      waitingOnCredit: false,
      paid: true,
      ideaEngineOn: true,
      ...this.ideaState.get(roundId),
      orders: [],
      personRemoved: false,
      closedEarly: false,
      dateChanged: false,
    };
  }

  // The money path runs against the real database (round-engine-holds.test.ts, E5);
  // rounds in this fake never reach needs_attention.
  async refresh(round: ClaimedRound) {
    return round;
  }
  async reconcile(): Promise<RoundStatus | null> {
    throw new Error("The money path isn't in the fake store");
  }
  /** Like release_round: gives the lease back, leaving status and next_action_at as they are. */
  async release(roundId: string, lock: Date): Promise<boolean> {
    const r = this.round(roundId);
    if (r.lockedUntil?.getTime() !== lock.getTime()) return false;
    this.writes.push(`release:${roundId}`);
    r.lockedUntil = null;
    r.attempts = 0;
    return true;
  }
  async cancelHeld(): Promise<RoundStatus | null> {
    throw new Error("The money path isn't in the fake store");
  }
  async markHoldEmailed(): Promise<void> {
    throw new Error("The money path isn't in the fake store");
  }
  async claimFailureNotices(): Promise<string[]> {
    throw new Error("The money path isn't in the fake store");
  }
  async releaseFailureNotices(): Promise<void> {
    throw new Error("The money path isn't in the fake store");
  }
  /** Paid features on and Zinc connected; off unless a test says so. */
  canBuyResult = false;
  async canBuy() {
    return this.canBuyResult;
  }
  async roundsMissingOrderedEmail() {
    return [];
  }
  async trackingCandidates() {
    return [];
  }
  async deliveredRoundsUntold() {
    return [];
  }
  /** What reactions_due finds, less the rounds already asked; what closes is SQL's. */
  reactionDue: { roundId: string; userId: string }[] = [];
  reactionAsks = new Map<string, ReactionAsk>();
  async closeReactedRounds(today: CalendarDate): Promise<number> {
    void today;
    return 0;
  }
  async reactionsDue(today: CalendarDate) {
    void today;
    return this.reactionDue.filter((r) => !this.sends.get(r.roundId)?.has("reaction_prompt"));
  }
  async reactionGifts(roundId: string): Promise<ReactionAsk | null> {
    return this.reactionAsks.get(roundId) ?? null;
  }
}
