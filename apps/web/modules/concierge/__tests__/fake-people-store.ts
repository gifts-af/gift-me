import type { Address, OccasionKind } from "@gifts-af/core";
import type {
  BudgetRow,
  NewPerson,
  OccasionRow,
  PeopleStore,
  PersonFields,
  PersonRow,
  ScheduleDays,
  StoredAddress,
} from "../people/store";

export const ME = "me";
export const OTHER = "someone-else";

function dbError(message: string, code: string, details?: string): Error {
  return Object.assign(new Error(message), { code, details });
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
  /** The caller's relationship defaults (budget_defaults), cents by relationship. */
  defaults = new Map<string, number>();
  lists = new Map<string, string>(); // share token -> owner
  /** Active list links: person -> share token (ALL-123). */
  links = new Map<string, string>();
  signed: string[][] = [];
  writes: string[] = [];
  /** Google contact id and address of imported people (ALL-24). */
  googleIds = new Map<string, string>();
  addresses = new Map<string, unknown>();
  photoSize = { px: 512, maxBytes: 10_485_760, timeoutMs: 5000, concurrency: 4 };
  uploads: { path: string; bytes: number; contentType: string }[] = [];
  /** Address columns by person (ALL-81); null once removed. Missing means never set. */
  addressRows = new Map<string, StoredAddress | null>();
  /** City and state the linked list owner shares, by person. */
  shared = new Map<string, { city: string; state: string }>();
  /** Makes saveAddress throw a database error that names the address, like a real one could. */
  failSaveAddress = false;
  /** Makes the next write of this name report 0 rows changed. */
  noRows = new Set<string>();
  private next = 1;

  /** Seeds a person for the caller (or another user) with occasions. */
  seed(
    owner: string,
    p: Partial<PersonRow> & { name: string },
    occasions: { kind: OccasionKind; month?: number; day?: number; enabled?: boolean }[] = [],
  ): string {
    const id = `00000000-0000-4000-8000-${String(this.next++).padStart(12, "0")}`;
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
    // Like the unique index on (user, Google contact id) for live people.
    if (p.googleContactId && [...this.googleIds].some(([id, g]) => g === p.googleContactId && this.mine(id))) {
      throw dbError("duplicate key value", "23505");
    }
    // Like add_person with a share token (ALL-123): the add and the link are
    // one transaction, so any refusal leaves no person behind.
    const owner = p.shareToken ? this.lists.get(p.shareToken) : undefined;
    if (p.shareToken) {
      if (!owner) throw dbError("List not found", "P0002");
      if (owner === this.caller) throw dbError("You cannot link a person to your own list", "22023");
      const linked = [...this.links].find(([id, t]) => t === p.shareToken && this.mine(id));
      if (linked) throw dbError("list_has_person", "P0001", linked[0]);
    }
    const id = this.seed(this.caller ?? "", { name: p.name, relationship: p.relationship, birthYear: p.birthYear });
    for (const kind of p.kinds) {
      const d = kind === "birthday" ? p.birthday : kind === "anniversary" ? p.anniversary : null;
      this.occasionRows.push({
        id: `o${this.next++}`, personId: id, kind, month: d?.month ?? null, day: d?.day ?? null, enabled: true,
      });
    }
    if (p.googleContactId) this.googleIds.set(id, p.googleContactId);
    if (p.address) this.addresses.set(id, p.address);
    if (p.shareToken && owner) {
      this.links.set(id, p.shareToken);
      this.rows.get(id)!.linkedUserId = owner;
    }
    return id;
  }

  async importedContactIds() {
    return [...this.googleIds].filter(([id]) => this.mine(id)).map(([, g]) => g);
  }

  async photoSettings() { return this.photoSize; }

  async uploadPhoto(path: string, bytes: Uint8Array, contentType: string) {
    this.write("uploadPhoto", path);
    if (!path.startsWith(`${this.caller}/`)) return false;
    this.uploads.push({ path, bytes: bytes.byteLength, contentType });
    return true;
  }

  async updatePersonFields(id: string, p: PersonFields) {
    this.write("updatePersonFields", id, JSON.stringify(p));
    const row = this.mine(id);
    if (!row || !this.changed("updatePersonFields")) return false;
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

  /** What the rounds say about a moved occasion; null has the switch off. */
  rounds: Awaited<ReturnType<PeopleStore["giftsAround"]>> = null;
  failGiftsAround = false;
  async giftsAround() {
    if (this.failGiftsAround) throw dbError("down", "XX000");
    return this.rounds;
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

  /** Like concierge.save_budgets: a number upserts, null removes (ALL-120). */
  async saveBudgets(personId: string, amounts: Record<string, number | null>) {
    this.write("saveBudgets", personId, JSON.stringify(amounts));
    if (!this.mine(personId)) throw dbError("Person not found", "P0002");
    for (const [kind, cents] of Object.entries(amounts)) {
      this.budgetRows = this.budgetRows.filter((b) => !(b.personId === personId && b.kind === kind));
      if (cents !== null) this.budgetRows.push({ personId, kind, cents });
    }
  }

  async relationshipDefault(relationship: string) {
    return this.defaults.get(relationship) ?? null;
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

  async address(personId: string) {
    if (!this.mine(personId)) return null;
    const empty: StoredAddress = {
      firstName: null, lastName: null, line1: null, line2: null, city: null, state: null, zip: null,
      country: "US", checkedAt: null,
    };
    return this.addressRows.get(personId) ?? empty;
  }

  async sharedCity(personId: string) {
    if (!this.mine(personId)) throw dbError("Person not found", "P0002");
    return this.shared.get(personId) ?? null;
  }

  async saveAddress(personId: string, a: (Address & { checkedAt: string }) | null) {
    this.write("saveAddress", personId);
    if (this.failSaveAddress) throw dbError(`Saving an address failed: bad row (${a?.line1})`, "XX000");
    if (!this.mine(personId) || !this.changed("saveAddress")) return false;
    this.addressRows.set(personId, a ? { ...a, country: "US" } : null);
    return true;
  }
}
