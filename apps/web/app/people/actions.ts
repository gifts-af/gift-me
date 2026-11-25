"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { GUIDED_QUESTIONS, IDEA_RUN_OFF, ideaRunWorstMs, parseDate, type OccasionKind } from "@gifts-af/core";
import { createExtractor } from "@/lib/ai/extract";
import { AI_MODELS } from "@/lib/ai/models";
import { appSettingInt } from "@/lib/app-settings";
import { googleImportEnabled } from "@/lib/google-import";
import { errorFields, logEvent } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { todayForRequest } from "@/lib/today";
import { scheduleNotesTip } from "./notes-tip";
import { onDemandIdeaDeps, placeAddressHeld } from "@/lib/wiring";
import { IDEA_MESSAGES, NO_FACTS } from "./[id]/ideas/messages";
import {
  addPerson,
  answerQuestions,
  confirmFact,
  costRecorder,
  deleteFact,
  getPerson,
  runIdeas,
  type IdeaOutcome,
  importPeople,
  isId,
  parseAnswers,
  parseFactEdit,
  setFactActive,
  skipQuestion,
  updateFact,
  type Db,
  parseAddressForm,
  parseBudgetForm,
  parseImportRows,
  parsePersonForm,
  deletePerson,
  readUnreadCaptures,
  removeAddress,
  saveAddress,
  linkList,
  parseShareToken,
  parseSavedGiftForm,
  removeSavedGift,
  saveGift,
  saveIdea,
  saveBudgets,
  setOccasionEnabled,
  setPhoto,
  unlinkList,
  parseBirthYear,
  parseMonthDay,
  removeDatedOccasion,
  renamePerson,
  setBirthYear,
  setDatedOccasion,
  setRelationship,
  type AddResult,
  type DatedKind,
  type AddressSaveResult,
  type ImportResult,
  type SaveResult,
} from "@/modules/concierge";
import { cleanGiftLink, linkUnlinkedPerson, readGiftLinkForUser, type GiftLinkRead } from "@/modules/lists";

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
  // From a shared list's "Add … to your people" (ALL-123): link it in the same save.
  const list = text(formData, "list").trim();
  const result = await addPerson(parsed.value, list === "" ? undefined : list);
  if (result.ok) {
    revalidatePath("/people");
    await tipAfterAdd({ id: result.id, name: parsed.value.name });
  }
  return result;
}

// The one-time notes tip (ALL-31 AC-15). Whatever goes wrong, the person is already added.
async function tipAfterAdd(person: { id: string; name: string }): Promise<void> {
  try {
    await scheduleNotesTip(person);
  } catch (e) {
    logEvent("inbound.tip_failed", { person_id: person.id, ...errorFields(e) });
  }
}

// About (ALL-127): each field saves on its own through useAutosave, so these
// take plain values, not forms. None moves rounds on.
const DATED: DatedKind[] = ["birthday", "anniversary"];
const isText = (...values: unknown[]) => values.every((v) => typeof v === "string");

/** Like refresh, plus Give, whose cards show the name and next date. */
function refreshPerson(result: SaveResult, id: string): SaveResult {
  if (result.ok) revalidatePath("/give");
  return refresh(result, id);
}

export async function renamePersonAction(id: string, name: string): Promise<SaveResult> {
  if (!isText(id, name)) return BAD_FORM;
  return refreshPerson(await renamePerson(id, name), id);
}

export async function setRelationshipAction(id: string, relationship: string): Promise<SaveResult> {
  if (!isText(id, relationship)) return BAD_FORM;
  return refreshPerson(await setRelationship(id, relationship), id);
}

/** Month and day as picked; only a real date is saved, and cleared fields never are. */
export async function setDatedOccasionAction(id: string, kind: string, month: string, day: string): Promise<SaveResult> {
  const dated = DATED.find((k) => k === kind);
  if (!dated || !isText(id, month, day)) return BAD_FORM;
  const parsed = parseMonthDay(month.trim(), day.trim());
  if (!parsed.ok) return parsed;
  // Both fields empty: About never sends that; clearing never removes a date ("Remove birthday" does).
  if (!parsed.value) return BAD_FORM;
  return refreshPerson(await setDatedOccasion(id, dated, parsed.value, await todayForRequest()), id);
}

/** The year's text; empty clears it. */
export async function setBirthYearAction(id: string, year: string): Promise<SaveResult> {
  if (!isText(id, year)) return BAD_FORM;
  const currentYear = parseDate(await todayForRequest()).year;
  const parsed = parseBirthYear(year, currentYear);
  if (!parsed.ok) return parsed;
  return refreshPerson(await setBirthYear(id, parsed.value, currentYear), id);
}

export async function removeDatedOccasionAction(id: string, kind: string): Promise<SaveResult> {
  const dated = DATED.find((k) => k === kind);
  if (!dated || !isText(id)) return BAD_FORM;
  return refreshPerson(await removeDatedOccasion(id, dated), id);
}

/** The Shipping address form (ALL-81): checked by format, then saved; a waiting round goes on at the next tick. */
export async function saveAddressAction(_previous: AddressSaveResult | null, formData: FormData): Promise<AddressSaveResult> {
  const parsed = parseAddressForm(formData);
  if (!parsed.ok) return parsed;
  const id = text(formData, "id");
  // This person's gifts held for an address are tried again (ALL-32), through the Zinc wiring.
  return refresh(await saveAddress(id, parsed.value, { placeAddressHeld }), id);
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

// The Budget screen's one Save (ALL-120): the base and each switched-on
// occasion, all or nothing. Each bad field gets its own message.
export async function saveBudgetsAction(
  _previous: unknown,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error?: string; errors?: Record<string, string> }> {
  const id = text(formData, "id");
  const parsed = parseBudgetForm(formData);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  return refresh(await saveBudgets(id, parsed.amounts), id);
}

export async function linkListAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const id = text(formData, "id");
  return refresh(await linkList(id, text(formData, "link")), id);
}

// The prompt at the top of a person's page (ALL-123). Unlike linkListAction it never replaces a
// link, because the link decides where a held gift ships.
export async function linkUnlinkedListAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const id = text(formData, "id");
  const token = parseShareToken(text(formData, "link"));
  if (!token) return { ok: false, error: "Paste the share link from their GiftsAF list." };
  const result = await linkUnlinkedPerson(token, id);
  if (!result.ok) return { ok: false, error: result.error };
  const userId = (await (await createClient()).auth.getClaims()).data?.claims?.sub ?? null;
  logEvent("lists.linked_from_share", { user_id: userId, person_id: id, list_id: result.listId });
  return refresh({ ok: true }, id);
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
  // would flash a 404. Go straight to Give instead.
  revalidatePath("/give");
  revalidatePath("/people");
  redirect("/give");
}

// The Google Contacts import (ALL-24): the checklist sends only the ticked
// contacts, as JSON in `rows`. Rows the checks refuse count as failed.
export async function importContactsAction(_previous: ImportResult | null, formData: FormData): Promise<ImportResult> {
  if (!(await googleImportEnabled())) return { ok: false, error: "Google import is off for now. Add people by hand." };
  const currentYear = parseDate(await todayForRequest()).year;
  const parsed = parseImportRows(text(formData, "rows"), currentYear);
  if (!parsed.ok) return parsed;
  const result = await importPeople(parsed.rows);
  if (!result.ok) return result;
  revalidatePath("/give");
  revalidatePath("/people");
  const { firstAdded, ...counts } = result;
  if (firstAdded) await tipAfterAdd(firstAdded);
  return { ...counts, failed: result.failed + parsed.refused };
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

// "Looks right" on a ✨ fact (ALL-127): confirms it without changing it.
export async function confirmFactAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  if (!isId(text(formData, "id"))) return BAD_FORM;
  return refresh(await confirmFact(await db(), text(formData, "id")), text(formData, "personId"));
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
  const result = await readUnreadCaptures(
    createExtractor(AI_MODELS.extraction),
    costRecorder(createAdminClient),
    personId,
  );
  // Some may have been read even when another failed, so refresh either way.
  revalidatePath(`/people/${personId}`);
  return result;
}

// Saved gifts on a person's page (ALL-93). Reading a pasted link fills the
// form; Save cleans the link again on the server, so a Save tapped before
// the read finished still stores a clean link, or refuses a bad one.
export async function readGiftLinkAction(url: string): Promise<GiftLinkRead> {
  return readGiftLinkForUser(url);
}

export async function saveGiftAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const id = text(formData, "id");
  const link = text(formData, "link").trim();
  if (link) {
    const clean = await cleanGiftLink(link);
    if (!clean.ok) return clean;
    formData.set("link", clean.productUrl);
  }
  const parsed = parseSavedGiftForm(formData);
  if (!parsed.ok) return parsed;
  return refresh(await saveGift(id, parsed.value), id);
}

export async function removeSavedGiftAction(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const id = text(formData, "id");
  return refresh(await removeSavedGift(id, text(formData, "gift")), id);
}

// Save on a suggested idea (ALL-128): only the idea's id comes from the browser; the server copies
// the idea itself. The person's page shows the new saved-gifts count.
export async function saveIdeaAction(personId: string, ideaId: string): Promise<SaveResult> {
  if (!isText(personId, ideaId)) return BAD_FORM;
  const result = await saveIdea(personId, ideaId);
  if (result.ok) revalidatePath(`/people/${personId}/ideas`);
  return refresh(result, personId);
}

// The Gift ideas screen's button (ALL-27): one on-demand run for a person on the buyer's own
// list, within the run's worst-case time (two AI and two Zinc timeouts). The page has 300 s.
type SuggestResult = { ok: true; count: number } | { ok: false; error: string };

function suggestResult(outcome: IdeaOutcome): SuggestResult {
  switch (outcome.status) {
    case "saved":
      return { ok: true, count: outcome.count };
    case "none":
      return { ok: false, error: IDEA_MESSAGES.none };
    case "no_facts":
      return { ok: false, error: NO_FACTS };
    case "off":
      return { ok: false, error: IDEA_MESSAGES.off };
    case "refused":
      if (outcome.reason === "busy") return { ok: false, error: IDEA_MESSAGES.busy };
      if (outcome.reason === "not_paid") return { ok: false, error: IDEA_RUN_OFF };
      if (outcome.reason === "not_found") return { ok: false, error: IDEA_MESSAGES.notFound };
      // "done" and "limit" are a round's; an on-demand run never gets them.
      return { ok: false, error: IDEA_MESSAGES.failed };
    default:
      // failed, deadline, cost_cap
      return { ok: false, error: IDEA_MESSAGES.failed };
  }
}

export async function suggestIdeasAction(personId: string): Promise<SuggestResult> {
  const gone: SuggestResult = { ok: false, error: IDEA_MESSAGES.notFound };
  if (typeof personId !== "string" || !isId(personId)) return gone;
  const userId = (await (await createClient()).auth.getClaims()).data?.claims?.sub;
  if (!userId) return gone;
  const today = await todayForRequest();
  // RLS: only the buyer's own, undeleted person.
  if (!(await getPerson(personId, today))) return gone;
  try {
    const deps = await onDemandIdeaDeps(today);
    if (!deps) {
      logEvent("ideas.not_configured", { user_id: userId, person_id: personId });
      return { ok: false, error: IDEA_MESSAGES.failed };
    }
    const [aiMs, zincMs, listLookupsMax, zincPerSecond] = await Promise.all([
      appSettingInt("idea_ai_timeout_ms"),
      appSettingInt("idea_zinc_timeout_ms"),
      appSettingInt("idea_list_lookups_max"),
      appSettingInt("zinc_requests_per_second"),
    ]);
    const outcome = await runIdeas(
      { userId, personId, roundId: null, signal: AbortSignal.timeout(ideaRunWorstMs(aiMs, zincMs, listLookupsMax, zincPerSecond)) },
      deps,
    );
    revalidatePath(`/people/${personId}/ideas`);
    revalidatePath(`/people/${personId}`);
    return suggestResult(outcome);
  } catch (e) {
    logEvent("ideas.action_failed", { user_id: userId, person_id: personId, ...errorFields(e) });
    return { ok: false, error: IDEA_MESSAGES.failed };
  }
}
