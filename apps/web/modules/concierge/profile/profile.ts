import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CATEGORY_GROUPS,
  factSourceLabel,
  nextStep,
  openQuestions,
  readinessLabel,
  readinessScore,
  type Database,
  type FactCategory,
  type GuidedQuestion,
  type NextStep,
  type QuestionKey,
  type ReadinessLabel,
  type ReadinessSettings,
} from "@gifts-af/core";
import { logEvent } from "@/lib/log";
import type { SaveResult } from "../settings";
import type { Answer } from "./rules";

// A person's profile (ALL-26, C-4, C-6, C-7, T53). Callers build the client and
// pass it in (E3), so RLS applies for the signed-in user, and the round engine
// and idea engine can read the same way with the server's client.

export type Db = SupabaseClient<Database>;

const POSTGRES_UNIQUE = "23505";
const POSTGRES_CHECK = "23514";
const POSTGRES_NO_DATA = "P0002";

export type ActiveFact = {
  id: string;
  category: FactCategory;
  value: string;
  source: string;
  sourceId: string | null;
  confirmed: boolean;
};

export type ProfileFact = ActiveFact & { sourceLabel: string; sourceTitle: string | null; sourceUrl: string | null };

export type Readiness = { score: number; label: ReadinessLabel; step: NextStep };

export type Profile = {
  groups: { category: FactCategory; label: string; facts: ProfileFact[] }[];
  off: ProfileFact[];
  unread: number;
  openCount: number;
  /** Null when the meter is switched off. */
  readiness: Readiness | null;
};

async function setting(db: Db, key: string): Promise<number> {
  const { data, error } = await db.schema("concierge").rpc("setting_int", { p_key: key });
  if (error) throw new Error(`Reading setting ${key} failed: ${error.message}`);
  if (typeof data !== "number") throw new Error(`Setting ${key} is missing.`);
  return data;
}

type FactRow = { id: string; category: string; value: string; source: string; source_id: string | null; confirmed: boolean };

const FACT_COLUMNS = "id, category, value, source, source_id, confirmed";

const toFact = (f: FactRow): ActiveFact => ({
  id: f.id,
  category: f.category as FactCategory,
  value: f.value,
  source: f.source,
  sourceId: f.source_id,
  confirmed: f.confirmed,
});

/**
 * What the app knows about a person (design §3.1): the one read of their active
 * facts, which idea generation (ALL-27) uses too. A deleted or turned-off fact
 * isn't here, so it can't shape an idea.
 */
export async function activeFacts(db: Db, personId: string): Promise<ActiveFact[]> {
  const { data, error } = await db
    .schema("concierge")
    .from("profile_facts")
    .select(FACT_COLUMNS)
    .eq("person_id", personId)
    .eq("active", true)
    .order("created_at");
  if (error) throw new Error(`Couldn't load facts: ${error.message}`);
  return data.map(toFact);
}

async function skippedKeys(db: Db, personId: string): Promise<string[]> {
  const { data, error } = await db
    .schema("concierge")
    .from("questions")
    .select("question_key")
    .eq("person_id", personId)
    .eq("status", "dismissed");
  if (error) throw new Error(`Couldn't load questions: ${error.message}`);
  return data.flatMap((q) => (q.question_key ? [q.question_key] : []));
}

/** The questions open for a person right now. Empty when `guided_questions_max` is 0. */
export async function getOpenQuestions(db: Db, personId: string): Promise<GuidedQuestion[]> {
  const [max, facts, skipped] = await Promise.all([
    setting(db, "guided_questions_max"),
    activeFacts(db, personId),
    skippedKeys(db, personId),
  ]);
  return openQuestions(facts.map((f) => f.category), skipped, max);
}

async function readinessSettings(db: Db): Promise<ReadinessSettings> {
  const [interests, wants, avoid, sizes, brands, owns, ownList, readyPct] = await Promise.all(
    [
      "readiness_points_interests",
      "readiness_points_wants",
      "readiness_points_avoid",
      "readiness_points_sizes",
      "readiness_points_brands",
      "readiness_points_owns",
      "readiness_points_own_list",
      "readiness_ready_pct",
    ].map((key) => setting(db, key)),
  );
  return { points: { interests, wants, avoid, sizes, brands, owns }, ownList, readyPct };
}

/** Everything the person page shows about what we know (AC-1, AC-5, AC-7). */
export async function getProfile(db: Db, personId: string, keepsList: boolean): Promise<Profile> {
  const concierge = db.schema("concierge");
  const [facts, captures, skipped, max, meterOn] = await Promise.all([
    concierge.from("profile_facts").select(`${FACT_COLUMNS}, active`).eq("person_id", personId).order("created_at"),
    concierge.from("captures").select("id, status, page_title, source_url").eq("person_id", personId),
    skippedKeys(db, personId),
    setting(db, "guided_questions_max"),
    setting(db, "readiness_meter_enabled"),
  ]);
  if (facts.error) throw new Error(`Couldn't load facts: ${facts.error.message}`);
  if (captures.error) throw new Error(`Couldn't load captures: ${captures.error.message}`);

  const byId = new Map(captures.data.map((c) => [c.id, c]));
  const shown = (f: FactRow): ProfileFact => {
    const capture = f.source === "capture" && f.source_id ? byId.get(f.source_id) : undefined;
    return {
      ...toFact(f),
      sourceLabel: factSourceLabel(f.source, f.confirmed),
      sourceTitle: capture?.page_title ?? null,
      sourceUrl: capture?.source_url ?? null,
    };
  };
  const on = facts.data.filter((f) => f.active).map(shown);
  const open = openQuestions(on.map((f) => f.category), skipped, max);

  let readiness: Readiness | null = null;
  if (meterOn === 1) {
    const s = await readinessSettings(db);
    const score = readinessScore(on.map((f) => f.category), keepsList, s);
    readiness = { score, label: readinessLabel(score, s.readyPct), step: nextStep(open.length, score, s.readyPct) };
  }

  return {
    groups: CATEGORY_GROUPS.map((g) => ({ ...g, facts: on.filter((f) => f.category === g.category) })).filter(
      (g) => g.facts.length > 0,
    ),
    off: facts.data.filter((f) => !f.active).map(shown),
    unread: captures.data.filter((c) => c.status === "pending" || c.status === "failed").length,
    openCount: open.length,
    readiness,
  };
}

async function currentUserId(db: Db): Promise<string | null> {
  return (await db.auth.getClaims()).data?.claims?.sub ?? null;
}

/** Saves one form of answers in one transaction (AC-2). `answers` come from `parseAnswers`. */
export async function answerQuestions(db: Db, personId: string, answers: Answer[]): Promise<SaveResult> {
  const { data, error } = await db
    .schema("concierge")
    .rpc("answer_questions", { p_person_id: personId, p_answers: answers });
  if (error) {
    if (error.code === POSTGRES_CHECK) return { ok: false, error: "One of those is too long. Shorten it and try again." };
    if (error.code === POSTGRES_NO_DATA) return { ok: false, error: "This person is no longer on your list." };
    logEvent("questions.answer_failed", { person_id: personId, code: error.code });
    return { ok: false, error: "Your answers didn't save. Try again." };
  }
  logEvent("questions.answered", {
    user_id: await currentUserId(db),
    person_id: personId,
    questions: answers.length,
    facts: data,
  });
  return { ok: true };
}

/**
 * Skipped questions aren't asked again (AC-9, decision 45). The last choice wins,
 * even over an earlier answer: a question comes back once its facts are deleted,
 * and Skip has to work on it then. Skipping from a stale form keeps the facts.
 */
export async function skipQuestion(db: Db, personId: string, key: QuestionKey, prompt: string): Promise<SaveResult> {
  const { error } = await db
    .schema("concierge")
    .from("questions")
    .upsert(
      { person_id: personId, question_key: key, prompt, status: "dismissed" },
      { onConflict: "person_id,question_key" },
    );
  if (error) {
    logEvent("questions.skip_failed", { person_id: personId, code: error.code });
    return { ok: false, error: "That didn't go through. Try again." };
  }
  logEvent("questions.skipped", { user_id: await currentUserId(db), person_id: personId, key });
  return { ok: true };
}

/** Saying a fact is right, by fixing it, counts as confirming it (AC-6). */
export async function updateFact(
  db: Db,
  factId: string,
  edit: { category: FactCategory; value: string },
): Promise<SaveResult> {
  const { data, error } = await db
    .schema("concierge")
    .from("profile_facts")
    .update({ category: edit.category, value: edit.value, confirmed: true })
    .eq("id", factId)
    .select("id");
  if (error?.code === POSTGRES_UNIQUE) return { ok: false, error: "That's already on their profile (it may be turned off)." };
  if (error?.code === POSTGRES_CHECK) return { ok: false, error: "That's too long. Shorten it and try again." };
  if (error || data.length === 0) {
    logEvent("profile.fact_change_failed", { fact_id: factId, code: error?.code ?? "no_row" });
    return { ok: false, error: "That didn't save. Try again." };
  }
  logEvent("profile.fact_edited", { user_id: await currentUserId(db), fact_id: factId });
  return { ok: true };
}

/** Off keeps the text so the AI won't suggest it again (AC-5, D47, D51). */
export async function setFactActive(db: Db, factId: string, active: boolean): Promise<SaveResult> {
  const { data, error } = await db
    .schema("concierge")
    .from("profile_facts")
    .update({ active })
    .eq("id", factId)
    .select("id");
  if (error || data.length === 0) {
    logEvent("profile.fact_change_failed", { fact_id: factId, code: error?.code ?? "no_row" });
    return { ok: false, error: "That didn't go through. Try again." };
  }
  logEvent(active ? "profile.fact_turned_on" : "profile.fact_turned_off", { user_id: await currentUserId(db), fact_id: factId });
  return { ok: true };
}

/** Delete is real: the row and its text are gone (AC-4, C-7, D51). */
export async function deleteFact(db: Db, factId: string): Promise<SaveResult> {
  const { data, error } = await db.schema("concierge").from("profile_facts").delete().eq("id", factId).select("id");
  if (error || data.length === 0) {
    logEvent("profile.fact_change_failed", { fact_id: factId, code: error?.code ?? "no_row" });
    return { ok: false, error: "That didn't delete. Try again." };
  }
  logEvent("profile.fact_deleted", { user_id: await currentUserId(db), fact_id: factId });
  return { ok: true };
}
