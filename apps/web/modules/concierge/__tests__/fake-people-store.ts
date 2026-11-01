import type { OccasionKind } from "@gifts-af/core";
import type {
  BudgetRow,
  NewPerson,
  OccasionRow,
  PeopleStore,
  PersonRow,
  ScheduleDays,
} from "../people/store";

export const ME = "me";
export const OTHER = "someone-else";

function dbError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * An in-memory PeopleStore that behaves like row-level security: the caller
 * (ME) sees only their own live people. Every write is logged in `writes`, so
 * tests can assert that a refused call changed nothing.
 */
export class FakePeopleStore implements PeopleStore {
  caller: string | null = ME;
  schedules: ScheduleDays = { planningDeliveryDays: 7, safetyBufferDays: 2, fastestDaysToArrive: 2 };
  owners = new Map<string, string>();
  deleted = new Set<string>();
  rows = new Map<string, PersonRow>();
  occasionRows: OccasionRow[] = [];
  budgetRows: BudgetRow[] = [];
  lists = new Map<string, string>(); // share token -> owner
  signed: string[][] = [];
  writes: string[] = [];
  /** Makes the next write of this name report 0 rows changed. */
  noRows = new Set<string>();
  private next = 1;

  /** Seeds a person for the caller (or another user) with occasions. */
  seed(
    owner: string,
    p: Partial<PersonRow> & { name: string },
    occasions: { kind: OccasionKind; month?: number; day?: number; enabled?: boolean }[] = [],
  ): string {
    const id = `p${this.next++}`;
    this.owners.set(id, owner);
    this.rows.set(id, {
      id, relationship: "friend", birthYear: null, photoPath: null, linkedUserId: null, ...p,
    });
    for (const o of occasions) {
      this.occasionRows.push({
        id: `o${this.next++}`, personId: id, kind: o.kind, month: o.month ?? null, day: o.day ?? null,
        enabled: o.enabled ?? true,
      });
    }
    return id;
  }

  private mine(id: string): PersonRow | null {
    const row = this.rows.get(id);
    if (!row || this.owners.get(id) !== this.caller || this.deleted.has(id)) return null;
    return row;
  }

  private occasion(id: string): OccasionRow | null {
    const o = this.occasionRows.find((x) => x.id === id);
    return o && this.mine(o.personId) ? o : null;
  }

  private write(name: string, ...args: unknown[]) {
    this.writes.push([name, ...args].join(" "));
  }

  private changed(name: string): boolean {
    return !this.noRows.delete(name);
  }

  async userId() { return this.caller; }
  async schedule() { return this.schedules; }
  async people() { return [...this.rows.keys()].map((id) => this.mine(id)).filter((p) => p !== null); }
  async person(id: string) { return this.mine(id); }
  async occasions(ids: string[]) {
    return this.occasionRows.filter((o) => ids.includes(o.personId) && this.mine(o.personId));
  }
  async budgets(ids: string[]) {
    return this.budgetRows.filter((b) => ids.includes(b.personId) && this.mine(b.personId));
  }
  async signPhotos(paths: string[]) {
    this.signed.push(paths);
    return new Map(paths.map((p) => [p, `https://signed.test/${p}`]));
  }

  async createPerson(p: NewPerson) {
    this.write("createPerson", JSON.stringify(p));
    const id = this.seed(this.caller ?? "", { name: p.name, relationship: p.relationship, birthYear: p.birthYear });
    for (const kind of p.kinds) {
      const d = kind === "birthday" ? p.birthday : kind === "anniversary" ? p.anniversary : null;
      this.occasionRows.push({
        id: `o${this.next++}`, personId: id, kind, month: d?.month ?? null, day: d?.day ?? null, enabled: true,
      });
    }
    return id;
  }

  async updatePerson(id: string, p: { name: string; relationship: string; birthYear: number | null }) {
    this.write("updatePerson", id);
    const row = this.mine(id);
    if (!row || !this.changed("updatePerson")) return false;
    Object.assign(row, p);
    return true;
  }

  async addOccasion(personId: string, o: { kind: OccasionKind; month: number | null; day: number | null }) {
    this.write("addOccasion", personId, o.kind);
    if (!this.mine(personId)) throw dbError("row-level security", "42501");
    this.occasionRows.push({ id: `o${this.next++}`, personId, enabled: true, ...o });
  }

  async moveOccasion(occasionId: string, month: number, day: number) {
    this.write("moveOccasion", occasionId);
    const o = this.occasion(occasionId);
    if (!o || !this.changed("moveOccasion")) return false;
    o.month = month;
    o.day = day;
    return true;
  }

  async removeOccasion(occasionId: string) {
    this.write("removeOccasion", occasionId);
    if (!this.occasion(occasionId)) throw dbError("Occasion not found", "P0002");
    this.occasionRows = this.occasionRows.filter((o) => o.id !== occasionId);
  }

  async setEnabled(occasionId: string, enabled: boolean) {
    this.write("setEnabled", occasionId, enabled);
    const o = this.occasion(occasionId);
    if (!o || !this.changed("setEnabled")) return false;
    o.enabled = enabled;
    return true;
  }

  async upsertBudget(personId: string, kind: string, cents: number | null) {
    this.write("upsertBudget", personId, kind, cents);
    if (!this.mine(personId)) throw dbError("row-level security", "42501");
    const existing = this.budgetRows.find((b) => b.personId === personId && b.kind === kind);
    if (existing) existing.cents = cents;
    else this.budgetRows.push({ personId, kind, cents });
  }

  async linkList(token: string, personId: string) {
    this.write("linkList", token, personId);
    if (!this.mine(personId)) throw dbError("Person not found", "P0002");
    const owner = this.lists.get(token);
    if (!owner) throw dbError("List not found", "P0002");
    if (owner === this.caller) throw dbError("own list", "22023");
    this.rows.get(personId)!.linkedUserId = owner;
  }

  async unlinkList(personId: string) {
    this.write("unlinkList", personId);
    const row = this.mine(personId);
    if (!row) throw dbError("Person not found", "P0002");
    row.linkedUserId = null;
  }

  async setPhotoPath(personId: string, path: string | null) {
    this.write("setPhotoPath", personId, path);
    const row = this.mine(personId);
    if (!row || !this.changed("setPhotoPath")) return false;
    row.photoPath = path;
    return true;
  }

  async deletePerson(personId: string) {
    this.write("deletePerson", personId);
    if (!this.mine(personId)) throw dbError("Person not found", "P0002");
    this.deleted.add(personId);
  }
}
