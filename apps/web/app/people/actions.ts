"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { GUIDED_QUESTIONS, parseDate, type OccasionKind } from "@gifts-af/core";
import { createExtractor } from "@/lib/ai/extract";
import { AI_MODELS } from "@/lib/ai/models";
import { appSettingInt } from "@/lib/app-settings";
import { createClient } from "@/lib/supabase/server";
import { todayForRequest } from "@/lib/today";
import { buyingWiring, placeHeld } from "@/app/settings/zinc-deps";
import {
  addPerson,
  answerQuestions,
  deleteFact,
  importPeople,
  isId,
  parseAnswers,
  parseFactEdit,
  setFactActive,
  skipQuestion,
  updateFact,
  type Db,
  parseAddressForm,
  parseBudget,
  parseImportRows,
  parsePersonForm,
  deletePerson,
  readUnreadCaptures,
  removeAddress,
  saveAddress,
  linkList,
  setBudget,
  setOccasionEnabled,
  setPhoto,
  unlinkList,
  updatePerson,
  type AddResult,
  type AddressSaveResult,
  type ImportResult,
  type SaveResult,
} from "@/modules/concierge";

// Server actions for the people screens, shaped for useActionState:
// (previous result, form data) -> result. Forms send the person as a hidden
// `id` field.

const OCCASION_KINDS: OccasionKind[] = [
  "birthday", "anniversary", "christmas", "valentines_day", "mothers_day", "fathers_day",
];

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

function kindOf(formData: FormData): OccasionKind | null {
  return OCCASION_KINDS.find((k) => k === text(formData, "kind")) ?? null;
}

const BAD_FORM: SaveResult = { ok: false, error: "That didn't go through. Reload and try again." };

function refresh(result: SaveResult, id?: string): SaveResult {
  if (result.ok) {
    revalidatePath("/people");
    if (id) revalidatePath(`/people/${id}`);
  }
  return result;
}

export async function addPersonAction(_previous: AddResult | null, formData: FormData): Promise<AddResult> {
  const currentYear = parseDate(await todayForRequest()).year;
  const parsed = parsePersonForm(formData, currentYear);
  if (!parsed.ok) return parsed;
  const result = await addPerson(parsed.value);
  if (result.ok) revalidatePath("/people");
  return result;
}

/** The round engine with the real buying side, for rounds that go on once an address arrives. */
const engineNow = async () => (await buyingWiring(new Date())).engine;

export async function updatePersonAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const currentYear = parseDate(await todayForRequest()).year;
  const parsed = parsePersonForm(formData, currentYear, { anyAnniversary: true });
  if (!parsed.ok) return parsed;
  const id = text(formData, "id");
  return refresh(await updatePerson(id, parsed.value, engineNow), id);
}

/** The Shipping address form (ALL-81): checked by format, then saved; a waiting round goes on. */
export async function saveAddressAction(_previous: AddressSaveResult | null, formData: FormData): Promise<AddressSaveResult> {
  const parsed = parseAddressForm(formData);
  if (!parsed.ok) return parsed;
  const id = text(formData, "id");
  // Held gifts waiting on an address are tried again (ALL-32); both come from the Zinc wiring.
  return refresh(await saveAddress(id, parsed.value, { placeHeld, engine: engineNow }), id);
}

export async function removeAddressAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const id = text(formData, "id");
  return refresh(await removeAddress(id), id);
}

export async function setOccasionEnabledAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const id = text(formData, "id");
  const kind = kindOf(formData);
  if (!kind) return BAD_FORM;
  return refresh(await setOccasionEnabled(id, kind, text(formData, "enabled") === "true"), id);
}

export async function setBudgetAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const id = text(formData, "id");
  const kind = kindOf(formData);
  if (!kind) return BAD_FORM;
  const budget = parseBudget(text(formData, "budget"));
  if (!budget.ok) return budget;
  return refresh(await setBudget(id, kind, budget.cents), id);
}

export async function linkListAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const id = text(formData, "id");
  return refresh(await linkList(id, text(formData, "link")), id);
}

export async function unlinkListAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const id = text(formData, "id");
  return refresh(await unlinkList(id), id);
}

// The browser uploads the photo itself (Task 6); this saves where it went.
export async function setPhotoAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const id = text(formData, "id");
  const path = text(formData, "path");
  return refresh(await setPhoto(id, path === "" ? null : path), id);
}

export async function deletePersonAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const result = await deletePerson(text(formData, "id"));
  if (!result.ok) return result;
  // Not the person's own path: revalidating it while the user is still on it
  // would flash a 404. Go straight Home instead.
  revalidatePath("/");
  revalidatePath("/people");
  redirect("/");
}

// The Google Contacts import (ALL-24): the checklist sends only the ticked
// contacts, as JSON in `rows`. Rows the checks refuse count as failed.
export async function importContactsAction(_previous: ImportResult | null, formData: FormData): Promise<ImportResult> {
  const currentYear = parseDate(await todayForRequest()).year;
  const parsed = parseImportRows(text(formData, "rows"), currentYear);
  if (!parsed.ok) return parsed;
  const result = await importPeople(parsed.rows);
  if (!result.ok) return result;
  revalidatePath("/");
  revalidatePath("/people");
  return { ...result, failed: result.failed + parsed.refused };
}

// "What we know" (ALL-26): edit, turn off or delete a fact; read unread captures.
const db = async () => (await createClient()) as unknown as Db;

export async function editFactAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const parsed = parseFactEdit({ category: text(formData, "category"), value: text(formData, "value") });
  if (!parsed.ok) return parsed;
  if (!isId(text(formData, "id"))) return BAD_FORM;
  const edit = { category: parsed.category, value: parsed.value };
  return refresh(await updateFact(await db(), text(formData, "id"), edit), text(formData, "personId"));
}

export async function setFactActiveAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  if (!isId(text(formData, "id"))) return BAD_FORM;
  const active = text(formData, "active") === "true";
  return refresh(await setFactActive(await db(), text(formData, "id"), active), text(formData, "personId"));
}

export async function deleteFactAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  if (!isId(text(formData, "id"))) return BAD_FORM;
  return refresh(await deleteFact(await db(), text(formData, "id")), text(formData, "personId"));
}

// Guided questions (ALL-26): fields are named after each question's key.
export async function answerQuestionsAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const personId = text(formData, "personId");
  if (!isId(personId)) return BAD_FORM;
  const fields = Object.fromEntries(GUIDED_QUESTIONS.map((q) => [q.key, text(formData, q.key)]));
  const parsed = parseAnswers(fields, await appSettingInt("guided_answer_max_facts"));
  if (!parsed.ok) return parsed;
  const result = await answerQuestions(await db(), personId, parsed.answers);
  if (result.ok) {
    revalidatePath(`/people/${personId}`);
    revalidatePath(`/people/${personId}/questions`);
  }
  return result;
}

export async function skipQuestionAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const personId = text(formData, "personId");
  const question = GUIDED_QUESTIONS.find((q) => q.key === text(formData, "key"));
  if (!question || !isId(personId)) return BAD_FORM;
  const result = await skipQuestion(await db(), personId, question.key, question.prompt);
  if (result.ok) {
    revalidatePath(`/people/${personId}`);
    revalidatePath(`/people/${personId}/questions`);
  }
  return result;
}

export async function readCapturesAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const personId = text(formData, "personId");
  const result = await readUnreadCaptures(createExtractor(AI_MODELS.extraction), personId);
  // Some may have been read even when another failed, so refresh either way.
  revalidatePath(`/people/${personId}`);
  return result;
}
