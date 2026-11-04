import type { CalendarDate, OccasionKind, RoundStatus, ScheduleSettings, StepKey } from "@gifts-af/core";
import type {
  Candidate,
  ClaimedRound,
  NewRoundRow,
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
};

export type FakePerson = { name: string; hasAddress: boolean; openQuestions?: number };

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
  ideas = new Map<string, { title: string; totalCents: number }[]>();
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
    };
  }

  async claimDue(now: Date) {
    const minutes = await this.setting("round_lock_minutes");
    return this.rounds
      .filter((r) => this.claimable(r, now))
      .sort((a, b) => a.nextActionAt!.getTime() - b.nextActionAt!.getTime())
      .map((r) => this.take(r, now, minutes));
  }

  async claim(roundId: string, now: Date) {
    const minutes = await this.setting("round_lock_minutes");
    const r = this.rounds.find((x) => x.id === roundId);
    return r && this.claimable(r, now) ? this.take(r, now, minutes) : null;
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
      personId: r.personId,
      personName: person.name,
      occasionKind: kind,
      occasionDate: r.occasionDate,
      shipByDeadline: r.shipByDeadline,
      hasAddress: person.hasAddress,
      openQuestions: person.openQuestions ?? 0,
      ideas: this.ideas.get(roundId) ?? [],
    };
  }

  async waitingRoundsForPerson(personId: string, now: Date) {
    const waiting = this.rounds.filter((r) => r.personId === personId && r.status === "needs_address");
    for (const r of waiting) {
      this.writes.push(`due:${r.id}`);
      r.nextActionAt = now;
    }
    return waiting.map((r) => r.id);
  }
}
