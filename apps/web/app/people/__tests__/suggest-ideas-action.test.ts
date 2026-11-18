import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDEA_RUN_OFF } from "@gifts-af/core";
import { IDEA_MESSAGES, NO_FACTS } from "../[id]/ideas/messages";

// suggestIdeasAction (ALL-27): who may run, the run's time limit, and the words for
// each outcome. runIdeas is faked; the real run is in e2e/suggest-ideas.spec.ts.

const runIdeas = vi.hoisted(() => vi.fn());
const getPerson = vi.hoisted(() => vi.fn());
const onDemandIdeaDeps = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
const claims = vi.hoisted(() => ({ sub: "u1" as string | undefined }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/today", () => ({ todayForRequest: async () => "2026-11-01" }));
vi.mock("@/app/settings/zinc-deps", () => ({ placeAddressHeld: async () => {}, onDemandIdeaDeps }));
vi.mock("@/lib/app-settings", () => ({
  appSettingInt: async (key: string) => ({ idea_ai_timeout_ms: 60000, idea_zinc_timeout_ms: 15000 })[key],
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: claims.sub ? { claims: { sub: claims.sub } } : null }) } }),
}));
vi.mock("@/modules/concierge", async () => {
  const rules = await vi.importActual<typeof import("@/modules/concierge/profile/rules")>("@/modules/concierge/profile/rules");
  return { runIdeas, getPerson, isId: rules.isId };
});

import { suggestIdeasAction } from "../actions";

const ID = "6f1c2b9e-4a7d-4c3e-9b1a-2d5e8f0a1b2c";
const DEPS = { fake: "deps" };

describe("suggestIdeasAction", () => {
  beforeEach(() => {
    claims.sub = "u1";
    runIdeas.mockReset();
    getPerson.mockReset().mockResolvedValue({ id: ID, name: "Dad" });
    onDemandIdeaDeps.mockReset().mockResolvedValue(DEPS);
    revalidatePath.mockClear();
  });

  it("runs on demand for the signed-in buyer, inside the run's worst-case time, and refreshes", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    runIdeas.mockResolvedValue({ status: "saved", count: 3 });
    expect(await suggestIdeasAction(ID)).toEqual({ ok: true, count: 3 });
    expect(getPerson).toHaveBeenCalledWith(ID, "2026-11-01");
    expect(onDemandIdeaDeps).toHaveBeenCalledWith("2026-11-01");
    const [req, deps] = runIdeas.mock.calls[0];
    expect(req).toMatchObject({ userId: "u1", personId: ID, roundId: null });
    expect(req.signal).toBeInstanceOf(AbortSignal);
    expect(deps).toBe(DEPS);
    expect(timeout).toHaveBeenCalledWith(150000);
    expect(revalidatePath).toHaveBeenCalledWith(`/people/${ID}/ideas`);
    expect(revalidatePath).toHaveBeenCalledWith(`/people/${ID}`);
    timeout.mockRestore();
  });

  it.each([
    [{ status: "none" }, IDEA_MESSAGES.none],
    [{ status: "no_facts" }, NO_FACTS],
    [{ status: "refused", reason: "busy" }, IDEA_MESSAGES.busy],
    [{ status: "off" }, IDEA_MESSAGES.off],
    [{ status: "failed" }, IDEA_MESSAGES.failed],
    [{ status: "deadline" }, IDEA_MESSAGES.failed],
    [{ status: "cost_cap" }, IDEA_MESSAGES.failed],
    [{ status: "refused", reason: "not_paid" }, IDEA_RUN_OFF],
    [{ status: "refused", reason: "not_found" }, IDEA_MESSAGES.notFound],
  ])("says what happened: %j", async (outcome, error) => {
    runIdeas.mockResolvedValue(outcome);
    expect(await suggestIdeasAction(ID)).toEqual({ ok: false, error });
  });

  it("runs nothing for a person who isn't on the buyer's list", async () => {
    getPerson.mockResolvedValue(null);
    expect(await suggestIdeasAction(ID)).toEqual({ ok: false, error: IDEA_MESSAGES.notFound });
    expect(await suggestIdeasAction("not-an-id")).toEqual({ ok: false, error: IDEA_MESSAGES.notFound });
    claims.sub = undefined;
    expect(await suggestIdeasAction(ID)).toEqual({ ok: false, error: IDEA_MESSAGES.notFound });
    expect(runIdeas).not.toHaveBeenCalled();
  });

  it("fails without running when the vendors aren't set up here", async () => {
    onDemandIdeaDeps.mockResolvedValue(null);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await suggestIdeasAction(ID)).toEqual({ ok: false, error: IDEA_MESSAGES.failed });
    expect(runIdeas).not.toHaveBeenCalled();
    const events = log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
    expect(events).toEqual([expect.objectContaining({ event: "ideas.not_configured", user_id: "u1", person_id: ID })]);
    log.mockRestore();
  });
});
