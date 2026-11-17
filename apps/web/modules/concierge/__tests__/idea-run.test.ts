// One idea run (ALL-27 Task 6) with an in-memory store and fake Gateway and Zinc servers.
// Nothing here reaches a real vendor: both are plain fetch fakes (E5, no money while testing).
import type { ScheduleSettings } from "@gifts-af/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_MODELS } from "@/lib/ai/models";
import { runIdeas, type IdeaDeps, type IdeaRequest } from "../ideas/run";
import type { IdeaInputs, IdeaRefusal, IdeaSettings, IdeaStore, RunEnd, RunStage, SavedIdea } from "../ideas/store";

const SCHEDULE: ScheduleSettings = {
  planningDeliveryDays: 7,
  safetyBufferDays: 2,
  roundLeadDays: 28,
  reminder1AfterHeadsUpDays: 5,
  reminder2BeforeDeadlineDays: 7,
  finalNoticeBeforeDeadlineDays: 2,
  fastestDaysToArrive: 1,
  holdReminderDays: 7,
  holdFinalDays: 2,
};

const settings = (o: Partial<IdeaSettings> = {}): IdeaSettings => ({
  enabled: true,
  candidates: 8,
  maxSearches: 3,
  aiMaxTokens: 6000,
  aiTimeoutMs: 60000,
  keepMin: 3,
  keepMax: 5,
  taxPct: 8,
  runMaxCents: 100,
  zincLookupCents: 1,
  zincRequestsPerSecond: 10,
  orderFeeCents: 100,
  schedule: SCHEDULE,
  ...o,
});

const fact = (value: string) => ({ id: `f-${value}`, category: "interest" as const, value, source: "question", sourceId: null, confirmed: true });

const inputs = (o: Partial<IdeaInputs> = {}): IdeaInputs => ({
  relationship: "father",
  names: ["Smith", "Bob", "Jim"],
  facts: [fact("Bob loves fishing")],
  excluded: [],
  avoidTitles: [],
  overBudgetPct: 15,
  round: null,
  occasions: [{ rule: { kind: "birthday", month: 12, day: 20 }, ownBudgetCents: 3000 }],
  baseBudgetCents: null,
  defaultBudgetCents: null,
  ...o,
});

class FakeStore implements IdeaStore {
  s = settings();
  paid = true;
  in: IdeaInputs | null = inputs();
  refusal: IdeaRefusal | null = null;
  started: { personId: string; now: Date }[] = [];
  progressed: { stage: RunStage; cost: number }[] = [];
  finished: { outcome: RunEnd; cost: number }[] = [];
  saved: SavedIdea[] = [];
  async settings() {
    return this.s;
  }
  async hasPaidFeatures() {
    return this.paid;
  }
  async inputs() {
    return this.in;
  }
  async start(req: { personId: string }, now: Date) {
    if (this.refusal) return { refused: this.refusal };
    this.started.push({ personId: req.personId, now });
    return { runId: "run-1" };
  }
  async progress(_runId: string, stage: RunStage, cost: number) {
    this.progressed.push({ stage, cost });
  }
  async finish(_runId: string, outcome: RunEnd, cost: number) {
    this.finished.push({ outcome, cost });
  }
  async save(_runId: string, ideas: SavedIdea[]) {
    this.saved = ideas;
    return ideas.length;
  }
}

type Idea = { title: string; search: string; brand: string | null; why: string };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A fake Gateway: free prices, a brainstorm (the call with tools) and a rank. */
class FakeGateway {
  ideas: Idea[] = [];
  bodies: { system: string; content: string; tools: boolean }[] = [];
  brainstormUsage = { input_tokens: 1000, output_tokens: 1000, server_tool_use: { web_search_requests: 3 } };
  reasons: Record<string, string> = {};
  fetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/models")) {
      // 0.001¢ an input token, 0.01¢ an output token, 1¢ a search.
      return json({ data: [{ id: AI_MODELS.ideas, pricing: { input: "0.00001", output: "0.0001", web_search: "10" } }] });
    }
    const body = JSON.parse(String(init?.body));
    const content = body.messages[0].content as string;
    this.bodies.push({ system: body.system, content, tools: Boolean(body.tools) });
    if (body.tools) {
      return json({ content: [{ type: "text", text: JSON.stringify({ ideas: this.ideas }) }], usage: this.brainstormUsage });
    }
    const ids = [...content.matchAll(/- id (c\d+):/g)].map((m) => m[1]);
    const order = ids.map((id) => ({ id, reason: this.reasons[id] ?? `Reason for ${id}` }));
    return json({ content: [{ type: "text", text: JSON.stringify({ order }) }], usage: { input_tokens: 500, output_tokens: 200 } });
  }) as typeof fetch;
  get messages() {
    return this.bodies.length;
  }
}

type RawOffer = Record<string, unknown>;
const rawOffer = (o: RawOffer = {}): RawOffer => ({
  offer_id: "offer",
  price: 2000,
  available: true,
  condition: "New",
  buy_box_winner: true,
  seller: { name: "Amazon", first_party: true },
  handling_days: { max: 1 },
  shipping_options: [{ price: 500, delivery_days: { min: 2, max: 4 } }],
  ...o,
});

/** A fake Zinc: search by query, offers by product id; a number is an error status. */
class FakeZinc {
  search = new Map<string, { product_id: string; title: string; price: number }[] | number>();
  offers = new Map<string, RawOffer[] | number>();
  calls: { kind: "search" | "offers"; at: number; target: string }[] = [];
  onCall: ((kind: "search" | "offers") => Promise<void> | void) | null = null;
  constructor(private now: () => number) {}
  fetch = (async (input: string) => {
    const url = new URL(input);
    const isSearch = url.pathname === "/products/search";
    const target = isSearch ? url.searchParams.get("query")! : decodeURIComponent(url.pathname.split("/")[2]);
    this.calls.push({ kind: isSearch ? "search" : "offers", at: this.now(), target });
    await this.onCall?.(isSearch ? "search" : "offers");
    const reply = isSearch ? this.search.get(target) : this.offers.get(target);
    if (reply === undefined) return json({ error: { code: "not_found" } }, 404);
    if (typeof reply === "number") return json({ error: { code: "x" } }, reply);
    return json(isSearch ? { results: reply } : { offers: reply });
  }) as typeof fetch;
}

/** n candidates c1..cn: search "thing i", product Pi titled "Acme thing i", priced as given. */
function world(prices: number[], o: { zinc: FakeZinc; gateway: FakeGateway }) {
  o.gateway.ideas = prices.map((_, i) => ({ title: `Idea ${i + 1}`, search: `thing ${i + 1}`, brand: "Acme", why: "fits" }));
  prices.forEach((price, i) => {
    o.zinc.search.set(`thing ${i + 1}`, [{ product_id: `P${i + 1}`, title: `Acme thing ${i + 1}`, price }]);
    o.zinc.offers.set(`P${i + 1}`, [rawOffer({ offer_id: `offer-${i + 1}`, price })]);
  });
}

let t: number;
let store: FakeStore;
let gateway: FakeGateway;
let zinc: FakeZinc;
let log: ReturnType<typeof vi.spyOn>;

const req = (o: Partial<IdeaRequest> = {}): IdeaRequest => ({
  userId: "user-1",
  personId: "person-1",
  roundId: null,
  signal: new AbortController().signal,
  ...o,
});

const deps = (): IdeaDeps => ({
  store,
  gateway: { base: "https://gateway.test", apiKey: "gw-key", fetch: gateway.fetch },
  zinc: { http: { base: "https://zinc.test", timeoutMs: 15000, fetch: zinc.fetch }, key: "zinc-key" },
  today: "2026-11-17",
  clock: () => t,
  sleep: async (ms) => {
    t += ms;
  },
});

const lines = (): string[] => log.mock.calls.map((c: unknown[]) => String(c[0]));
const events = (): Record<string, unknown>[] =>
  lines()
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((e): e is Record<string, unknown> => e !== null);
const event = (name: string) => events().find((e) => e.event === name);

beforeEach(() => {
  t = 1_000_000;
  store = new FakeStore();
  gateway = new FakeGateway();
  zinc = new FakeZinc(() => t);
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
});

describe("runIdeas: nothing spent", () => {
  it("off spends nothing and starts no run", async () => {
    store.s = settings({ enabled: false });
    world([2000], { zinc, gateway });
    expect(await runIdeas(req(), deps())).toEqual({ status: "off" });
    expect(store.started).toEqual([]);
    expect(gateway.messages).toBe(0);
    expect(zinc.calls).toEqual([]);
    expect(event("ideas.run")).toMatchObject({ outcome: "off", run_id: null });
  });

  it("not paid spends nothing", async () => {
    store.paid = false;
    world([2000], { zinc, gateway });
    expect(await runIdeas(req(), deps())).toEqual({ status: "refused", reason: "not_paid" });
    expect(store.started).toEqual([]);
    expect(gateway.messages).toBe(0);
    expect(zinc.calls).toEqual([]);
  });

  it("no facts spends nothing and starts no run", async () => {
    store.in = inputs({ facts: [] });
    world([2000], { zinc, gateway });
    expect(await runIdeas(req(), deps())).toEqual({ status: "no_facts" });
    expect(store.started).toEqual([]);
    expect(gateway.messages).toBe(0);
    expect(zinc.calls).toEqual([]);
  });

  it("a person who isn't live is refused as not found, with no run", async () => {
    store.in = null;
    expect(await runIdeas(req(), deps())).toEqual({ status: "refused", reason: "not_found" });
    expect(store.started).toEqual([]);
    expect(gateway.messages).toBe(0);
  });

  it("done, busy and limit refusals spend nothing", async () => {
    world([2000], { zinc, gateway });
    for (const reason of ["done", "busy", "limit"] as const) {
      store.refusal = reason;
      expect(await runIdeas(req({ roundId: "round-1" }), deps())).toEqual({ status: "refused", reason });
    }
    expect(gateway.messages).toBe(0);
    expect(zinc.calls).toEqual([]);
    expect(store.finished).toEqual([]);
  });
});

describe("runIdeas: results", () => {
  it("saves up to keepMax within plus one over, from live offers only", async () => {
    // c1–c6 within $30 (2760 delivered), c7 and c8 over (3300, 3408), c9 only used.
    world([2000, 2000, 2000, 2000, 2000, 2000, 2500, 2600, 1000], { zinc, gateway });
    zinc.offers.set("P9", [rawOffer({ price: 1000, condition: "Used - Good" })]);

    const outcome = await runIdeas(req(), deps());

    expect(outcome).toEqual({ status: "saved", count: 6 });
    expect(store.saved.map((i) => i.retailerProductId)).toEqual(["P1", "P2", "P3", "P4", "P5", "P7"]);
    expect(store.saved.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(store.saved[0]).toEqual({
      title: "Acme thing 1",
      retailer: "amazon",
      productUrl: "https://www.amazon.com/dp/P1",
      retailerProductId: "P1",
      offerId: "offer-1",
      sellerName: "Amazon",
      firstParty: true,
      priceCents: 2000,
      estShippingCents: 500,
      estTaxCents: 160,
      estTotalCents: 2760,
      handlingDaysMax: 1,
      deliveryDaysMin: 2,
      deliveryDaysMax: 4,
      arriveBy: "2026-11-22",
      reason: "Reason for c1",
      overBudget: false,
      rank: 1,
    });
    expect(store.saved[5]).toMatchObject({ overBudget: true, estTotalCents: 3300 });
    expect(store.progressed.map((p) => p.stage)).toEqual(["brainstormed", "resolved", "ranked"]);
    expect(store.finished).toEqual([{ outcome: "saved", cost: expect.any(Number) }]);
    expect(event("ideas.run")).toMatchObject({
      run_id: "run-1",
      user_id: "user-1",
      person_id: "person-1",
      round_id: null,
      candidates: 9,
      resolved: 8,
      kept: 6,
      short: false,
      outcome: "saved",
    });
    expect(event("ideas.candidate_dropped")).toMatchObject({ reason: "unavailable" });
  });

  it("the budget falls back to the base budget, then the default", async () => {
    world([2000], { zinc, gateway });
    store.in = inputs({
      occasions: [{ rule: { kind: "birthday", month: 12, day: 20 }, ownBudgetCents: null }],
      baseBudgetCents: 4000,
      defaultBudgetCents: 2500,
    });
    await runIdeas(req(), deps());
    expect(gateway.bodies[0].content).toContain("Budget: $40.00");

    gateway.bodies = [];
    store.in = inputs({ occasions: [], baseBudgetCents: null, defaultBudgetCents: 2500 });
    await runIdeas(req(), deps());
    expect(gateway.bodies[0].content).toContain("Budget: $25.00");
    // 2760 delivered is over a $25 budget.
    expect(store.saved[0]).toMatchObject({ overBudget: true, arriveBy: null });
  });

  it("a round run uses the round's budget, and its deadline as the order date", async () => {
    world([2000, 2000], { zinc, gateway });
    // Deadline Dec 18, occasion Dec 20: 1 + 4 days from the 18th arrives after the buffer.
    zinc.offers.set("P2", [rawOffer({ handling_days: { max: 0 }, shipping_options: [{ price: 500, delivery_days: { min: 0, max: 0 } }] })]);
    store.in = inputs({
      round: { occasion: "birthday", occasionDate: "2026-12-20", shipByDeadline: "2026-12-18", budgetCents: 5000 },
    });
    const outcome = await runIdeas(req({ roundId: "round-1" }), deps());
    expect(outcome).toEqual({ status: "saved", count: 1 });
    expect(store.saved[0]).toMatchObject({ retailerProductId: "P2", arriveBy: "2026-12-18", overBudget: false });
    expect(gateway.bodies[0].content).toContain("Budget: $50.00");
    expect(event("ideas.candidate_dropped")).toMatchObject({ reason: "late" });
  });

  it("the prompts carry the account's over-budget allowance and the keep settings", async () => {
    world([2000, 2000], { zinc, gateway });
    store.in = inputs({ overBudgetPct: 25 });
    store.s = settings({ keepMin: 2, keepMax: 4 });
    await runIdeas(req(), deps());
    expect(gateway.bodies[0].system).toContain("up to 25% over");
    expect(gateway.bodies[1].system).toContain("keep the top 2 to 4.");
  });

  it("two searches that find the same product save it once", async () => {
    world([2000, 2000, 2000], { zinc, gateway });
    zinc.search.set("thing 2", [{ product_id: "P1", title: "Acme thing 1", price: 2000 }]);
    expect(await runIdeas(req(), deps())).toEqual({ status: "saved", count: 2 });
    expect(store.saved.map((i) => i.retailerProductId)).toEqual(["P1", "P3"]);
    expect(event("ideas.candidate_dropped")).toMatchObject({ reason: "duplicate" });
    expect(event("ideas.run")).toMatchObject({ resolved: 2 });
  });

  it("a run with nothing left saves nothing and returns none", async () => {
    world([9000, 9000], { zinc, gateway });
    expect(await runIdeas(req(), deps())).toEqual({ status: "none" });
    expect(store.saved).toEqual([]);
    expect(store.finished).toEqual([{ outcome: "none", cost: expect.any(Number) }]);
    expect(gateway.messages).toBe(1);
  });
});

describe("runIdeas: vendor trouble", () => {
  it("a 429 on one candidate drops only that one", async () => {
    world([2000, 2000, 2000], { zinc, gateway });
    zinc.search.set("thing 2", 429);
    expect(await runIdeas(req(), deps())).toEqual({ status: "saved", count: 2 });
    expect(store.saved.map((i) => i.retailerProductId)).toEqual(["P1", "P3"]);
    expect(event("ideas.candidate_dropped")).toMatchObject({ reason: "vendor_error", kind: "unavailable" });
  });

  it("all candidates unavailable ends failed, not none", async () => {
    world([2000, 2000], { zinc, gateway });
    zinc.search.set("thing 1", 503);
    zinc.search.set("thing 2", 503);
    expect(await runIdeas(req(), deps())).toEqual({ status: "failed" });
    expect(store.finished).toEqual([{ outcome: "failed", cost: expect.any(Number) }]);
    expect(event("ideas.zinc_unauthorized")).toBeUndefined();
  });

  it("an unauthorized key ends failed and logs the alert", async () => {
    world([2000, 2000], { zinc, gateway });
    zinc.search.set("thing 1", 401);
    zinc.search.set("thing 2", 401);
    expect(await runIdeas(req(), deps())).toEqual({ status: "failed" });
    expect(event("ideas.zinc_unauthorized")).toMatchObject({ alert: true, run_id: "run-1" });
  });

  it("an abort while resolving ends deadline, not none", async () => {
    world([2000, 2000], { zinc, gateway });
    const controller = new AbortController();
    zinc.onCall = () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    };
    expect(await runIdeas(req({ signal: controller.signal }), deps())).toEqual({ status: "deadline" });
    expect(store.finished).toEqual([{ outcome: "deadline", cost: expect.any(Number) }]);
    expect(gateway.messages).toBe(1);
  });

  it("an unreadable AI reply ends failed and still counts its cost", async () => {
    gateway.fetch = (async (url: string) => {
      if (url.endsWith("/v1/models")) {
        return json({ data: [{ id: AI_MODELS.ideas, pricing: { input: "0.00001", output: "0.0001", web_search: "10" } }] });
      }
      return json({ content: [{ type: "text", text: "not json" }], usage: { input_tokens: 0, output_tokens: 2000 } });
    }) as typeof fetch;
    expect(await runIdeas(req(), deps())).toEqual({ status: "failed" });
    expect(store.finished).toEqual([{ outcome: "failed", cost: 20 }]);
  });

  it("a non-Zinc failure in one lookup starts no more lookups, and counts every one that started", async () => {
    world([2000, 2000, 2000], { zinc, gateway });
    store.s = settings({ zincRequestsPerSecond: 1 });
    // Every Zinc reply takes a moment, so slower candidates are still going when one fails.
    zinc.onCall = () => new Promise((r) => setTimeout(r, 1));
    let sleeps = 0;
    const d = deps();
    d.sleep = async (ms) => {
      // The second candidate's wait fails with an error that isn't Zinc's.
      if (++sleeps === 1) throw new TypeError("boom");
      t += ms;
    };
    let callsAtFinish = -1;
    const finish = store.finish.bind(store);
    store.finish = async (runId, outcome, cost) => {
      callsAtFinish = zinc.calls.length;
      return finish(runId, outcome, cost);
    };
    expect(await runIdeas(req(), d)).toEqual({ status: "failed" });
    await new Promise((r) => setTimeout(r, 50));
    expect(zinc.calls.length).toBe(callsAtFinish);
    expect(store.finished).toEqual([{ outcome: "failed", cost: 14 + zinc.calls.length }]);
  });

  it("an AI call cut off by its timeout marks the run's cost unknown", async () => {
    world([2000], { zinc, gateway });
    store.s = settings({ aiTimeoutMs: 5 });
    const prices = gateway.fetch;
    gateway.fetch = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/models")) return prices(url, init);
      // The brainstorm never answers: the timeout cuts it off, so what it used is never known.
      return new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason)));
    }) as typeof fetch;
    expect(await runIdeas(req(), deps())).toEqual({ status: "failed" });
    expect(store.finished).toEqual([{ outcome: "failed", cost: 0 }]);
    expect(event("ideas.run")).toMatchObject({ outcome: "failed", costUnknown: true });
  });

  it("a run whose AI calls all answered doesn't say its cost is unknown", async () => {
    world([2000], { zinc, gateway });
    await runIdeas(req(), deps());
    expect(event("ideas.run")).not.toHaveProperty("costUnknown");
  });

  it("a pricing failure is a counted, failed run that spends nothing", async () => {
    gateway.fetch = (async () => json({}, 500)) as typeof fetch;
    expect(await runIdeas(req(), deps())).toEqual({ status: "failed" });
    expect(store.started).toHaveLength(1);
    expect(store.finished).toEqual([{ outcome: "failed", cost: 0 }]);
    expect(zinc.calls).toEqual([]);
    expect(event("ideas.run")).toMatchObject({ run_id: "run-1", outcome: "failed", stage: "started" });
  });
});

describe("runIdeas: cost and speed", () => {
  it("stops at the cost cap and saves nothing", async () => {
    world([2000, 2000, 2000], { zinc, gateway });
    // 95.5¢ of output plus 3¢ of searches: room for one 1¢ lookup under the 100¢ cap.
    gateway.brainstormUsage = { input_tokens: 0, output_tokens: 9550, server_tool_use: { web_search_requests: 3 } };
    expect(await runIdeas(req(), deps())).toEqual({ status: "cost_cap" });
    expect(zinc.calls).toHaveLength(1);
    expect(store.saved).toEqual([]);
    expect(gateway.messages).toBe(1);
    expect(store.finished).toEqual([{ outcome: "cost_cap", cost: 100 }]);
    expect(event("ideas.run")).toMatchObject({ outcome: "cost_cap", cost_cents: 100 });
  });

  it("doesn't rank when the rank could pass the cap", async () => {
    world([2000, 2000, 2000], { zinc, gateway });
    // 14¢ brainstorm + 6¢ of lookups; a 6000-token rank reply alone is 60¢.
    store.s = settings({ runMaxCents: 70 });
    expect(await runIdeas(req(), deps())).toEqual({ status: "cost_cap" });
    expect(zinc.calls).toHaveLength(6);
    expect(gateway.messages).toBe(1);
    expect(store.saved).toEqual([]);
  });

  it("starts no more than zinc_requests_per_second calls a second", async () => {
    world([2000, 2000, 2000, 2000], { zinc, gateway });
    store.s = settings({ zincRequestsPerSecond: 2 });
    await runIdeas(req(), deps());
    const at = zinc.calls.map((c) => c.at);
    expect(at).toHaveLength(8);
    for (let i = 2; i < at.length; i++) expect(at[i] - at[i - 2]).toBeGreaterThanOrEqual(1000);
  });

  it("resolves candidates in parallel", async () => {
    world([2000, 2000, 2000], { zinc, gateway });
    let searches = 0;
    let offersSawAllSearches = true;
    zinc.onCall = async (kind) => {
      if (kind === "search") searches++;
      else if (searches < 3) offersSawAllSearches = false;
      // Let other candidates run before this call answers.
      await new Promise((r) => setTimeout(r, 0));
    };
    await runIdeas(req(), deps());
    expect(zinc.calls.slice(0, 3).map((c) => c.kind)).toEqual(["search", "search", "search"]);
    expect(offersSawAllSearches).toBe(true);
  });
});

describe("runIdeas: privacy and safety", () => {
  it("facts and avoid titles reach the AI with names replaced", async () => {
    world([2000, 2000], { zinc, gateway });
    store.in = inputs({ avoidTitles: ["Smith family tackle box for Bob"], facts: [fact("Bob loves fishing with Jim")] });
    await runIdeas(req(), deps());
    expect(gateway.bodies).toHaveLength(2);
    for (const b of gateway.bodies) {
      expect(b.content).not.toMatch(/Bob|Smith|Jim/);
      expect(b.content).toContain("them loves fishing with them");
    }
    expect(gateway.bodies[0].content).toContain("them family tackle box for them");
  });

  it("a search naming the person never reaches Zinc", async () => {
    world([2000, 2000], { zinc, gateway });
    gateway.ideas[1].search = "fishing rod for bob";
    await runIdeas(req(), deps());
    expect(zinc.calls.map((c) => c.target)).toEqual(["thing 1", "P1"]);
    expect(event("ideas.candidate_dropped")).toMatchObject({ reason: "names" });
  });

  it("a sensitive title or reason is dropped", async () => {
    world([2000, 2000, 2000], { zinc, gateway });
    gateway.reasons.c1 = "Helps with his diabetes";
    zinc.search.set("thing 3", [{ product_id: "P3", title: "Prayer journal", price: 2000 }]);
    gateway.ideas[2].brand = null;
    expect(await runIdeas(req(), deps())).toEqual({ status: "saved", count: 1 });
    expect(store.saved.map((i) => i.retailerProductId)).toEqual(["P2"]);
    expect(events().filter((e) => e.event === "ideas.candidate_dropped" && e.reason === "sensitive")).toHaveLength(2);
  });

  it("ideas.run carries no fact, title or reason text", async () => {
    world([2000, 2000], { zinc, gateway });
    store.in = inputs({ facts: [fact("Bob loves fishing")], avoidTitles: ["Old tackle box"] });
    await runIdeas(req(), deps());
    const all = lines().join("\n");
    for (const text of ["fishing", "Bob", "Smith", "Jim", "Acme", "Idea 1", "Reason for", "tackle", "thing"]) {
      expect(all).not.toContain(text);
    }
    expect(event("ideas.run_started")).toMatchObject({ run_id: "run-1" });
    expect(event("ideas.run")).toMatchObject({ kept: 2, short: true, stage: "ranked", ms: expect.any(Number) });
  });
});
