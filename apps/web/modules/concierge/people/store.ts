import "server-only";
import type { OccasionKind } from "@gifts-af/core";
import { appSettingInt } from "@/lib/app-settings";
import type { ImportAddress } from "./rules";
import { createClient } from "@/lib/supabase/server";

// Everything the people logic needs from the database (ALL-21). The interface
// keeps service.ts testable with an in-memory store; the Supabase version
// below is thin glue on the signed-in user's client, so row-level security
// decides whose rows are visible. A "false" return means the database said no
// row was changed (not yours, or deleted); a thrown error carries the
// Postgres code on `.code`.

export type PersonRow = {
  id: string;
  name: string;
  relationship: string;
  birthYear: number | null;
  photoPath: string | null;
  linkedUserId: string | null;
};

export type OccasionRow = {
  id: string;
  personId: string;
  kind: OccasionKind;
  month: number | null;
  day: number | null;
  enabled: boolean;
};

export type BudgetRow = { personId: string; kind: string; cents: number | null };

export type ScheduleDays = {
  planningDeliveryDays: number;
  safetyBufferDays: number;
  fastestDaysToArrive: number;
};

export type MonthDayRow = { month: number; day: number };

export type NewPerson = {
  name: string;
  relationship: string;
  kinds: OccasionKind[];
  birthday: MonthDayRow | null;
  birthYear: number | null;
  anniversary: MonthDayRow | null;
  /** From a Google Contacts import (ALL-24). */
  googleContactId?: string | null;
  address?: ImportAddress | null;
};

export interface PeopleStore {
  /** The signed-in user's id, or null. */
  userId(): Promise<string | null>;
  schedule(): Promise<ScheduleDays>;
  /** The caller's live people. */
  people(): Promise<PersonRow[]>;
  /** One of the caller's live people, or null. */
  person(id: string): Promise<PersonRow | null>;
  /** Live occasions of these people. */
  occasions(personIds: string[]): Promise<OccasionRow[]>;
  budgets(personIds: string[]): Promise<BudgetRow[]>;
  /** Signed links for photo paths, keyed by path. */
  signPhotos(paths: string[]): Promise<Map<string, string>>;

  createPerson(p: NewPerson): Promise<string>;
  updatePerson(id: string, p: { name: string; relationship: string; birthYear: number | null }): Promise<boolean>;
  addOccasion(personId: string, o: { kind: OccasionKind; month: number | null; day: number | null }): Promise<void>;
  moveOccasion(occasionId: string, month: number, day: number): Promise<boolean>;
  removeOccasion(occasionId: string): Promise<void>;
  setEnabled(occasionId: string, enabled: boolean): Promise<boolean>;
  upsertBudget(personId: string, kind: string, cents: number | null): Promise<void>;
  /** Throws with code P0002 (no such list) or 22023 (your own list). */
  linkList(token: string, personId: string): Promise<void>;
  unlinkList(personId: string): Promise<void>;
  setPhotoPath(personId: string, path: string | null): Promise<boolean>;
  /** Google contact ids of the caller's live imported people (ALL-24). */
  importedContactIds(): Promise<string[]>;
  photoSettings(): Promise<{ px: number; maxBytes: number; timeoutMs: number; concurrency: number }>;
  /** Puts a photo in the person-photos bucket; false when storage says no. */
  uploadPhoto(path: string, bytes: Uint8Array, contentType: string): Promise<boolean>;
  deletePerson(personId: string): Promise<void>;
}

// Signed photo links last this long: long enough to browse the list.
const PHOTO_LINK_SECONDS = 60 * 60;
const PERSON_COLUMNS = "id, name, relationship, birth_year, photo_path, linked_user_id";

type PersonDbRow = {
  id: string;
  name: string;
  relationship: string;
  birth_year: number | null;
  photo_path: string | null;
  linked_user_id: string | null;
};

function toPersonRow(r: PersonDbRow): PersonRow {
  return {
    id: r.id,
    name: r.name,
    relationship: r.relationship,
    birthYear: r.birth_year,
    photoPath: r.photo_path,
    linkedUserId: r.linked_user_id,
  };
}

function check(error: { message: string; code?: string } | null, what: string): void {
  if (!error) return;
  throw Object.assign(new Error(`${what}: ${error.message}`), { code: error.code });
}

export function createSupabasePeopleStore(): PeopleStore {
  const db = async () => (await createClient()).schema("concierge");

  return {
    async userId() {
      const supabase = await createClient();
      const { data } = await supabase.auth.getClaims();
      return data?.claims?.sub ?? null;
    },

    async schedule() {
      const [planningDeliveryDays, safetyBufferDays, fastestDaysToArrive] = await Promise.all([
        appSettingInt("planning_delivery_days"),
        appSettingInt("safety_buffer_days"),
        appSettingInt("fastest_days_to_arrive"),
      ]);
      return { planningDeliveryDays, safetyBufferDays, fastestDaysToArrive };
    },

    async people() {
      const supabase = await createClient();
      const { data, error } = await supabase.from("people").select(PERSON_COLUMNS).is("deleted_at", null);
      check(error, "Listing people failed");
      return (data ?? []).map(toPersonRow);
    },

    async person(id) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("people")
        .select(PERSON_COLUMNS)
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();
      check(error, "Loading a person failed");
      return data ? toPersonRow(data) : null;
    },

    async occasions(personIds) {
      if (personIds.length === 0) return [];
      const { data, error } = await (await db())
        .from("occasions")
        .select("id, person_id, kind, month, day, enabled")
        .in("person_id", personIds)
        .is("deleted_at", null);
      check(error, "Loading occasions failed");
      return (data ?? []).map((o) => ({
        id: o.id,
        personId: o.person_id ?? "",
        kind: o.kind as OccasionKind,
        month: o.month,
        day: o.day,
        enabled: o.enabled,
      }));
    },

    async budgets(personIds) {
      if (personIds.length === 0) return [];
      const { data, error } = await (await db())
        .from("budgets")
        .select("person_id, occasion_kind, amount_cents")
        .in("person_id", personIds);
      check(error, "Loading budgets failed");
      return (data ?? []).map((b) => ({ personId: b.person_id, kind: b.occasion_kind, cents: b.amount_cents }));
    },

    async signPhotos(paths) {
      const urls = new Map<string, string>();
      if (paths.length === 0) return urls;
      const supabase = await createClient();
      const { data, error } = await supabase.storage
        .from("person-photos")
        .createSignedUrls(paths, PHOTO_LINK_SECONDS);
      check(error, "Signing photo links failed");
      for (const item of data ?? []) {
        if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
      }
      return urls;
    },

    async createPerson(p) {
      const { data, error } = await (await db()).rpc("add_person", {
        p_name: p.name,
        p_relationship: p.relationship,
        p_kinds: p.kinds,
        p_birthday_month: p.birthday?.month,
        p_birthday_day: p.birthday?.day,
        p_birth_year: p.birthYear ?? undefined,
        p_anniversary_month: p.anniversary?.month,
        p_anniversary_day: p.anniversary?.day,
        p_google_contact_id: p.googleContactId ?? undefined,
        p_recipient_first_name: p.address?.firstName ?? undefined,
        p_recipient_last_name: p.address?.lastName ?? undefined,
        p_address_line1: p.address?.line1 ?? undefined,
        p_address_line2: p.address?.line2 ?? undefined,
        p_city: p.address?.city ?? undefined,
        p_state: p.address?.state ?? undefined,
        p_zip: p.address?.zip ?? undefined,
        p_country: p.address?.country ?? undefined,
      });
      check(error, "Adding a person failed");
      if (!data) throw new Error("Adding a person returned no id.");
      return data;
    },

    async updatePerson(id, p) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("people")
        .update({ name: p.name, relationship: p.relationship, birth_year: p.birthYear })
        .eq("id", id)
        .select("id");
      check(error, "Updating a person failed");
      return (data ?? []).length > 0;
    },

    async addOccasion(personId, o) {
      const { error } = await (await db())
        .from("occasions")
        .insert({ person_id: personId, kind: o.kind, month: o.month, day: o.day });
      check(error, "Adding an occasion failed");
    },

    async moveOccasion(occasionId, month, day) {
      const { data, error } = await (await db())
        .from("occasions")
        .update({ month, day })
        .eq("id", occasionId)
        .select("id");
      check(error, "Moving an occasion failed");
      return (data ?? []).length > 0;
    },

    async removeOccasion(occasionId) {
      const { error } = await (await db()).rpc("delete_occasion", { p_occasion_id: occasionId });
      check(error, "Removing an occasion failed");
    },

    async setEnabled(occasionId, enabled) {
      const { data, error } = await (await db())
        .from("occasions")
        .update({ enabled })
        .eq("id", occasionId)
        .select("id");
      check(error, "Switching an occasion failed");
      return (data ?? []).length > 0;
    },

    async upsertBudget(personId, kind, cents) {
      const { error } = await (await db())
        .from("budgets")
        .upsert(
          { person_id: personId, occasion_kind: kind, amount_cents: cents },
          { onConflict: "person_id,occasion_kind" },
        );
      check(error, "Saving a budget failed");
    },

    async linkList(token, personId) {
      const supabase = await createClient();
      const { error } = await supabase.schema("lists").rpc("link_person", { p_token: token, p_person_id: personId });
      check(error, "Linking a list failed");
    },

    async unlinkList(personId) {
      const supabase = await createClient();
      const { error } = await supabase.schema("lists").rpc("unlink_person", { p_person_id: personId });
      check(error, "Unlinking a list failed");
    },

    async setPhotoPath(personId, path) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("people")
        .update({ photo_path: path })
        .eq("id", personId)
        .select("id");
      check(error, "Saving a photo failed");
      return (data ?? []).length > 0;
    },

    async importedContactIds() {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("people")
        .select("google_contact_id")
        .not("google_contact_id", "is", null)
        .is("deleted_at", null);
      check(error, "Listing imported contacts failed");
      return (data ?? []).flatMap((r) => (r.google_contact_id ? [r.google_contact_id] : []));
    },

    async photoSettings() {
      const [px, maxBytes, timeoutMs, concurrency] = await Promise.all([
        appSettingInt("person_photo_px"),
        appSettingInt("person_photo_max_upload_bytes"),
        appSettingInt("contact_photo_timeout_ms"),
        appSettingInt("contact_photo_concurrency"),
      ]);
      return { px, maxBytes, timeoutMs, concurrency };
    },

    async uploadPhoto(path, bytes, contentType) {
      const supabase = await createClient();
      const { error } = await supabase.storage.from("person-photos").upload(path, bytes, { contentType });
      if (error) console.error("uploading a contact photo failed", error.message);
      return !error;
    },

    async deletePerson(personId) {
      const supabase = await createClient();
      const { error } = await supabase.rpc("delete_person", { p_person_id: personId });
      check(error, "Deleting a person failed");
    },
  };
}
