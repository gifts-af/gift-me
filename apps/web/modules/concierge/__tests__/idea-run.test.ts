// One idea run (ALL-27 Task 6) with an in-memory store and fake Gateway and Zinc servers.
// Nothing here reaches a real vendor: both are plain fetch fakes (E5, no money while testing).
import type { ScheduleSettings } from "@gifts-af/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_MODELS } from "@/lib/ai/models";
import type { IdeaDeps, IdeaRequest } from "../ideas/run";
import type { IdeaInputs, IdeaRefusal, IdeaSettings, IdeaStore, ListGift, RunEnd, RunStage, SavedIdea } from "../ideas/store";

// The run names a list gift's store with the lists product's storeName (T19), whose index is server-only.
vi.mock("server-only", () => ({}));
const { runIdeas } = await import("../ideas/run");

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
  listLookupsMax: 10,
  listMin: 3,
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
  listGifts: [],
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

type ZincKind = "search" | "offers" | "details" | "check";
type RawHit = { product_id: string; title: string; price: number; image?: string | null };

/**
 * A fake Zinc: search by query, offers and details by product id, the store check by URL;
 * a number is an error status.
 */
class FakeZinc {
  search = new Map<string, RawHit[] | number>();
  offers = new Map<string, RawOffer[] | number>();
  details = new Map<string, Record<string, unknown> | number>();
  orderable = new Set<string>();
  calls: { kind: ZincKind; at: number; target: string; retailer: string | null }[] = [];
  onCall: ((kind: ZincKind) => Promise<void> | void) | null = null;
  constructor(private now: () => number) {}
  fetch = (async (input: string) => {
    const url = new URL(input);
    const parts = url.pathname.split("/");
    const kind: ZincKind =
      url.pathname === "/products/search"
        ? "search"
        : url.pathname === "/retailers/check"
          ? "check"
          : parts[3] === "offers"
            ? "offers"
            : "details";
    const target =
      kind === "search" ? url.searchParams.get("query")! : kind === "check" ? url.searchParams.get("url")! : decodeURIComponent(parts[2]);
    this.calls.push({ kind, at: this.now(), target, retailer: url.searchParams.get("retailer") });
    await this.onCall?.(kind);
    if (kind === "check") return json({ orderable: this.orderable.has(target) });
    const reply = kind === "search" ? this.search.get(target) : kind === "offers" ? this.offers.get(target) : this.details.get(target);
    if (reply === undefined) return json({ error: { code: "not_found" } }, 404);
    if (typeof reply === "number") return json({ error: { code: "x" } }, reply);
    return json(kind === "search" ? { results: reply } : kind === "offers" ? { offers: reply } : reply);
  }) as typeof fetch;
  count(kind: ZincKind) {
    return this.calls.filter((c) => c.kind === kind).length;
  }
}

/** n candidates c1..cn: search "thing i", product Pi titled "Acme thing i", priced as given. */
function world(prices: number[], o: { zinc: FakeZinc; gateway: FakeGateway }) {
  o.gateway.ideas = prices.map((_, i) => ({ title: `Idea ${i + 1}`, search: `thing ${i + 1}`, brand: "Acme", why: "fits" }));
  prices.forEach((price, i) => {
    o.zinc.search.set(`thing ${i + 1}`, [
      { product_id: `P${i + 1}`, title: `Acme thing ${i + 1}`, price, image: `https://img.test/P${i + 1}.jpg` },
    ]);
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
      imageUrl: "https://img.test/P1.jpg",
      source: "generated",
      listItemId: null,
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
      round: { occasion: "birthday", occasionDate: "2026-12-20", shipByDeadline: "2026-12-18", budgetCents: 5000, maxTotalCents: null },
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

  it("with a share of 5 at 10 a second, lookups start 500 ms apart (ALL-125)", async () => {
    world([2000, 2000, 2000], { zinc, gateway });
    store.s = settings({ zincRequestsPerSecond: 10 });
    const start = t;
    await runIdeas(req(), { ...deps(), zincShare: 5 });
    const at = zinc.calls.slice(0, 5).map((c) => c.at - start);
    expect(at).toEqual([0, 500, 1000, 1500, 2000]);
  });

  it("with a share of 5 at 3 a second (0.6), lookups start at least 1667 ms apart (ALL-125)", async () => {
    world([2000, 2000, 2000], { zinc, gateway });
    store.s = settings({ zincRequestsPerSecond: 3 });
    const start = t;
    await runIdeas(req(), { ...deps(), zincShare: 5 });
    const at = zinc.calls.slice(0, 3).map((c) => c.at - start);
    expect(at[0]).toBe(0);
    expect(at[1]).toBeGreaterThanOrEqual(1667);
    expect(at[2]).toBeGreaterThanOrEqual(3333);
  });

  it("with no share, lookups keep today's spacing at 10 a second (ALL-125)", async () => {
    world([2000, 2000, 2000], { zinc, gateway });
    store.s = settings({ zincRequestsPerSecond: 10 });
    const start = t;
    await runIdeas(req(), deps());
    const at = zinc.calls.slice(0, 3).map((c) => c.at - start);
    expect(at).toEqual([0, 100, 200]);
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

  it("facts and avoid titles reach the AI with emails, phones and addresses removed (ALL-134)", async () => {
    world([2000, 2000], { zinc, gateway });
    store.in = inputs({
      avoidTitles: ["Mug engraved 12 Elm St"],
      facts: [fact("loves letters, write to 12 Elm St"), fact("texts from 555-123-4567 or bob@example.com"), fact("shoe size 10.5")],
    });
    await runIdeas(req(), deps());
    expect(gateway.bodies).toHaveLength(2);
    for (const b of gateway.bodies) {
      expect(b.content).not.toMatch(/Elm St|555-123-4567|example\.com/);
      expect(b.content).toContain("loves letters, write to [contact removed]");
      expect(b.content).toContain("shoe size 10.5");
    }
    expect(gateway.bodies[0].content).toContain("Mug engraved [contact removed]");
    // Only what's sent is filtered: the store's facts are untouched.
    expect(store.in!.facts[0].value).toBe("loves letters, write to 12 Elm St");
  });

  it("ideas.run carries no contact text (E6, ALL-134)", async () => {
    world([2000, 2000], { zinc, gateway });
    store.in = inputs({ facts: [fact("write to 12 Elm St, bob@example.com, 555-123-4567")] });
    await runIdeas(req(), deps());
    const all = lines().join("\n");
    for (const text of ["Elm", "example.com", "4567", "contact removed"]) expect(all).not.toContain(text);
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

// ─── list gifts first, photos, and the price ceiling (ALL-29 Task 6) ─────────

const ROUND = { occasion: "birthday" as const, occasionDate: "2026-12-20", shipByDeadline: "2026-12-10", budgetCents: 5000, maxTotalCents: null };

/** List gift i: an Amazon link (ASIN Li) priced at the list's $20, unless overridden. */
const gift = (i: number, o: Partial<ListGift> = {}): ListGift => ({
  itemId: `item-${i}`,
  name: `List gift ${i}`,
  url: `https://www.amazon.com/dp/L${i}`,
  asin: `L${i}`,
  listPriceCents: 2000,
  ...o,
});

/** n Amazon list gifts with live offers, each with a photo on its details page. */
function listWorld(n: number, z: FakeZinc, price = 2000): ListGift[] {
  return Array.from({ length: n }, (_, k) => {
    const i = k + 1;
    z.offers.set(`L${i}`, [rawOffer({ offer_id: `loff-${i}`, price })]);
    z.details.set(`L${i}`, { status: "completed", product_id: `L${i}`, main_image: `https://img.test/L${i}.jpg` });
    return gift(i);
  });
}

const roundReq = () => req({ roundId: "round-1" });

describe("runIdeas: list gifts first", () => {
  it("three qualifying list gifts are saved first and no brainstorm runs", async () => {
    world([2000, 2000], { zinc, gateway });
    store.in = inputs({ round: ROUND, listGifts: listWorld(3, zinc) });

    expect(await runIdeas(roundReq(), deps())).toEqual({ status: "saved", count: 3 });

    expect(gateway.messages).toBe(0);
    expect(zinc.count("search")).toBe(0);
    expect(store.saved.map((i) => [i.listItemId, i.rank, i.source])).toEqual([
      ["item-1", 1, "list"],
      ["item-2", 2, "list"],
      ["item-3", 3, "list"],
    ]);
    expect(store.saved[0]).toEqual({
      title: "List gift 1",
      retailer: "Amazon",
      productUrl: "https://www.amazon.com/dp/L1",
      retailerProductId: "L1",
      offerId: "loff-1",
      sellerName: "Amazon",
      firstParty: true,
      priceCents: 2000,
      estShippingCents: 500,
      estTaxCents: 160,
      estTotalCents: 2760,
      handlingDaysMax: 1,
      deliveryDaysMin: 2,
      deliveryDaysMax: 4,
      arriveBy: "2026-12-15",
      reason: "On their list",
      overBudget: false,
      rank: 1,
      imageUrl: "https://img.test/L1.jpg",
      source: "list",
      listItemId: "item-1",
    });
    // Three offers lookups and three photo calls.
    expect(store.finished).toEqual([{ outcome: "saved", cost: 6 }]);
    const listEvents = events().filter((e) => e.event === "ideas.list_gift");
    expect(listEvents).toHaveLength(3);
    expect(listEvents[0]).toEqual(expect.objectContaining({ run_id: "run-1", route: "amazon", outcome: "kept" }));
    // Ids, routes and outcomes only: no title, link or photo (E6, T42).
    const all = lines().join("\n");
    for (const text of ["List gift", "amazon.com", "img.test"]) expect(all).not.toContain(text);
  });

  it("two qualifying list gifts are kept and the brainstorm fills up to idea_keep_max", async () => {
    world([2000, 2000, 2000, 2000, 2000], { zinc, gateway });
    store.in = inputs({ round: ROUND, listGifts: listWorld(2, zinc) });

    expect(await runIdeas(roundReq(), deps())).toEqual({ status: "saved", count: 5 });

    expect(gateway.messages).toBe(2);
    expect(store.saved.map((i) => [i.source, i.rank])).toEqual([
      ["list", 1],
      ["list", 2],
      ["generated", 3],
      ["generated", 4],
      ["generated", 5],
    ]);
    expect(store.saved.slice(2).map((i) => i.retailerProductId)).toEqual(["P1", "P2", "P3"]);
    expect(store.saved[2]).toMatchObject({ listItemId: null, imageUrl: "https://img.test/P1.jpg" });
  });

  it("a person with no facts and one list gift gets that one idea", async () => {
    store.in = inputs({ facts: [], round: ROUND, listGifts: listWorld(1, zinc) });
    expect(await runIdeas(roundReq(), deps())).toEqual({ status: "saved", count: 1 });
    expect(gateway.messages).toBe(0);
    expect(store.saved).toEqual([expect.objectContaining({ source: "list", listItemId: "item-1", rank: 1 })]);
  });

  it("a 200-item list makes at most idea_list_lookups_max lookups and saves what qualified", async () => {
    const gifts = listWorld(200, zinc, 9000);
    // Only gifts 4 and 9 are within the allowance.
    zinc.offers.set("L4", [rawOffer({ price: 2000 })]);
    zinc.offers.set("L9", [rawOffer({ price: 2000 })]);
    store.in = inputs({ facts: [], round: ROUND, listGifts: gifts });

    expect(await runIdeas(roundReq(), deps())).toEqual({ status: "saved", count: 2 });

    expect(zinc.count("offers")).toBe(10);
    expect(zinc.calls.filter((c) => c.kind === "offers").map((c) => c.target)).toEqual(
      Array.from({ length: 10 }, (_, k) => `L${k + 1}`),
    );
    expect(store.saved.map((i) => i.listItemId)).toEqual(["item-4", "item-9"]);
  });

  it("stops looking once idea_keep_max list gifts qualify", async () => {
    store.s = settings({ keepMax: 2, zincRequestsPerSecond: 1 });
    store.in = inputs({ facts: [], round: ROUND, listGifts: listWorld(6, zinc) });
    // The rate limit's wait takes real time, so earlier replies are in before the next lookup's turn.
    const d = deps();
    d.sleep = async (ms) => {
      await new Promise((r) => setTimeout(r, 5));
      t += ms;
    };
    expect(await runIdeas(roundReq(), d)).toEqual({ status: "saved", count: 2 });
    expect(store.saved.map((i) => i.listItemId)).toEqual(["item-1", "item-2"]);
    expect(zinc.count("offers")).toBeLessThan(6);
  });

  it("list gifts that qualified are saved when the cost cap stops the brainstorm", async () => {
    world([2000, 2000, 2000], { zinc, gateway });
    store.in = inputs({ round: ROUND, listGifts: listWorld(2, zinc) });
    // 2¢ of list lookups, then 95.5¢ of output and 3¢ of searches: no room for any AI lookup.
    gateway.brainstormUsage = { input_tokens: 0, output_tokens: 9550, server_tool_use: { web_search_requests: 3 } };

    expect(await runIdeas(roundReq(), deps())).toEqual({ status: "saved", count: 2 });

    expect(store.saved.map((i) => i.listItemId)).toEqual(["item-1", "item-2"]);
    expect(store.finished).toEqual([{ outcome: "saved", cost: expect.any(Number) }]);
    expect(zinc.count("search")).toBe(0);
  });

  it("list gifts that qualified are saved when the deadline cuts the brainstorm off", async () => {
    store.in = inputs({ round: ROUND, listGifts: listWorld(1, zinc) });
    const controller = new AbortController();
    const prices = gateway.fetch;
    gateway.fetch = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/models")) return prices(url, init);
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    }) as typeof fetch;
    expect(await runIdeas(req({ roundId: "round-1", signal: controller.signal }), deps())).toEqual({ status: "saved", count: 1 });
    expect(store.finished).toEqual([{ outcome: "saved", cost: expect.any(Number) }]);
  });

  it("list gift titles never reach the brainstorm prompt", async () => {
    world([2000], { zinc, gateway });
    zinc.offers.set("L1", [rawOffer({ price: 2000 })]);
    store.in = inputs({ round: ROUND, listGifts: [gift(1, { name: "Grandma's secret lamp" })] });
    await runIdeas(roundReq(), deps());
    expect(gateway.bodies.length).toBeGreaterThan(0);
    for (const b of gateway.bodies) expect(`${b.system}\n${b.content}`).not.toMatch(/secret lamp/i);
  });

  it("a list gift that can't arrive in time, or is past the allowance, isn't saved", async () => {
    zinc.offers.set("L1", [rawOffer({ handling_days: { max: 9 } })]);
    zinc.offers.set("L2", [rawOffer({ price: 9000 })]);
    // A store Zinc can only check: the list's price, arriving in planning_delivery_days (7).
    const checked = gift(3, { url: "https://shop.example/blue-vase", asin: null, listPriceCents: 1500 });
    zinc.orderable.add(checked.url);
    store.in = inputs({ facts: [], round: ROUND, listGifts: [gift(1), gift(2), checked] });

    expect(await runIdeas(roundReq(), deps())).toEqual({ status: "saved", count: 1 });
    expect(store.saved[0]).toMatchObject({
      listItemId: "item-3",
      retailer: "shop.example",
      productUrl: "https://shop.example/blue-vase",
      retailerProductId: null,
      offerId: null,
      priceCents: 1500,
      estShippingCents: 0,
      estTotalCents: 1500 + 120 + 100,
      handlingDaysMax: 0,
      deliveryDaysMax: 7,
      arriveBy: "2026-12-17",
      imageUrl: null,
    });
    expect(events().filter((e) => e.event === "ideas.list_gift").map((e) => e.outcome)).toEqual(["late", "over_limit", "kept"]);

    // The same checked gift, with a deadline 7 days can't make (Dec 18 + 7 is past Dec 20 less the buffer).
    store.in = inputs({ facts: [], round: { ...ROUND, shipByDeadline: "2026-12-18" }, listGifts: [checked] });
    store.saved = [];
    expect(await runIdeas(roundReq(), deps())).toEqual({ status: "none" });
    expect(store.saved).toEqual([]);
  });

  it("a gift whose delivery Zinc doesn't know is judged on planning_delivery_days", async () => {
    // An Etsy listing: details with a price but no delivery days.
    const etsy = gift(1, { url: "https://www.etsy.com/listing/123/mug", asin: null });
    zinc.details.set("123", { status: "completed", product_id: "123", price: 2000, main_image: "https://img.test/e.jpg" });
    store.in = inputs({ facts: [], round: { ...ROUND, shipByDeadline: "2026-12-11" }, listGifts: [etsy] });
    expect(await runIdeas(roundReq(), deps())).toEqual({ status: "saved", count: 1 });
    expect(store.saved[0]).toMatchObject({
      retailer: "etsy.com",
      retailerProductId: "123",
      deliveryDaysMax: 7,
      arriveBy: "2026-12-18",
      imageUrl: "https://img.test/e.jpg",
    });
    // The photo came with the details: no second call.
    expect(zinc.calls).toHaveLength(1);

    store.in = inputs({ facts: [], round: { ...ROUND, shipByDeadline: "2026-12-14" }, listGifts: [etsy] });
    expect(await runIdeas(roundReq(), deps())).toEqual({ status: "none" });
  });

  it("list lookups count toward idea_run_max_cents", async () => {
    store.s = settings({ runMaxCents: 2 });
    store.in = inputs({ facts: [], round: ROUND, listGifts: listWorld(5, zinc) });
    expect(await runIdeas(roundReq(), deps())).toEqual({ status: "saved", count: 2 });
    expect(zinc.count("offers")).toBe(2);
    expect(zinc.count("details")).toBe(0);
    expect(store.finished).toEqual([{ outcome: "saved", cost: 2 }]);
  });

  it("a details lookup Zinc rejects, then the store check, is charged twice and counts twice toward idea_list_lookups_max", async () => {
    // Etsy listings with no details reply (404, rejected): each falls back to the store check.
    const etsy = (i: number) => gift(i, { url: `https://www.etsy.com/listing/${i}/mug`, asin: null, listPriceCents: 1500 });
    const gifts = [etsy(1), etsy(2)];
    for (const g of gifts) zinc.orderable.add(g.url);
    store.s = settings({ listLookupsMax: 3 });
    store.in = inputs({ facts: [], round: ROUND, listGifts: gifts });

    expect(await runIdeas(roundReq(), deps())).toEqual({ status: "saved", count: 1 });

    // Gift 1: details, then the check (2). Gift 2: details (3); its check would be the 4th.
    // The two gifts' lookups run side by side, so only the set is fixed.
    expect(zinc.calls.map((c) => `${c.kind} ${c.target}`).sort()).toEqual(["check https://www.etsy.com/listing/1/mug", "details 1", "details 2"]);
    expect(store.saved.map((i) => i.listItemId)).toEqual(["item-1"]);
    expect(store.finished).toEqual([{ outcome: "saved", cost: 3 }]);
  });

  it("a list gift already given or rejected as a product isn't offered", async () => {
    store.in = inputs({ facts: [], round: ROUND, listGifts: listWorld(2, zinc), excluded: ["L1"] });
    expect(await runIdeas(roundReq(), deps())).toEqual({ status: "saved", count: 1 });
    expect(store.saved.map((i) => i.listItemId)).toEqual(["item-2"]);
  });

  it("an AI idea for a product already kept from the list is dropped as a duplicate", async () => {
    world([2000, 2000], { zinc, gateway });
    zinc.search.set("thing 1", [{ product_id: "L1", title: "Acme thing 1", price: 2000, image: "https://img.test/x.jpg" }]);
    store.in = inputs({ round: ROUND, listGifts: listWorld(1, zinc) });
    await runIdeas(roundReq(), deps());
    expect(store.saved.map((i) => i.retailerProductId)).toEqual(["L1", "P2"]);
  });
});

describe("runIdeas: photos and the price ceiling", () => {
  it("a photo call never runs past the cost cap, and a failed one keeps the idea", async () => {
    // An AI hit without a photo gets one details call.
    world([2000, 2000], { zinc, gateway });
    zinc.search.set("thing 1", [{ product_id: "P1", title: "Acme thing 1", price: 2000, image: null }]);
    zinc.details.set("P1", { status: "completed", product_id: "P1", main_image: "https://img.test/details-P1.jpg" });
    expect(await runIdeas(req(), deps())).toEqual({ status: "saved", count: 2 });
    expect(store.saved.map((i) => i.imageUrl)).toEqual(["https://img.test/details-P1.jpg", "https://img.test/P2.jpg"]);
    expect(zinc.calls.filter((c) => c.kind === "details")).toEqual([expect.objectContaining({ target: "P1", retailer: "amazon" })]);

    // A failed photo call keeps the idea, with no photo.
    zinc.calls = [];
    zinc.details.set("P1", 500);
    expect(await runIdeas(req(), deps())).toEqual({ status: "saved", count: 2 });
    expect(store.saved[0]).toMatchObject({ retailerProductId: "P1", imageUrl: null });

    // With no room under the cap, no photo call is made and the ideas are still saved.
    zinc.calls = [];
    store.s = settings({ runMaxCents: 3 });
    store.in = inputs({ facts: [], round: ROUND, listGifts: listWorld(3, zinc) });
    expect(await runIdeas(roundReq(), deps())).toEqual({ status: "saved", count: 3 });
    expect(zinc.count("details")).toBe(0);
    expect(store.saved.map((i) => i.imageUrl)).toEqual([null, null, null]);
    expect(store.finished.at(-1)).toEqual({ outcome: "saved", cost: 3 });
  });

  it("an http photo is never kept", async () => {
    world([2000], { zinc, gateway });
    zinc.search.set("thing 1", [{ product_id: "P1", title: "Acme thing 1", price: 2000, image: "http://img.test/P1.jpg" }]);
    zinc.details.set("P1", { status: "completed", product_id: "P1", main_image: "http://img.test/P1.jpg" });
    await runIdeas(req(), deps());
    expect(store.saved[0].imageUrl).toBeNull();
  });

  it("after Too pricey, the brainstorm searches under the ceiling and a total at or above it drops", async () => {
    world([2000, 1000], { zinc, gateway });
    // P1 totals 2760, P2 1680. The ceiling is 2760: P1 drops.
    store.in = inputs({ round: { ...ROUND, maxTotalCents: 2760 } });
    expect(await runIdeas(roundReq(), deps())).toEqual({ status: "saved", count: 1 });
    expect(gateway.bodies[0].content).toContain("Budget: $27.60");
    expect(store.saved.map((i) => i.retailerProductId)).toEqual(["P2"]);
    expect(event("ideas.candidate_dropped")).toMatchObject({ reason: "over_limit" });
  });
});
