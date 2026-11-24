import { describe, expect, it } from "vitest";
import type { StepKey } from "@gifts-af/core";
import type { Channel } from "../notify/channels";
import type { RoundStore, TrackingCandidate } from "../rounds/store";
import { runTrackingNews } from "../tracking/news";
import { FakeStore } from "./fake-store";
import { captureLog } from "./round-engine-fakes";

// The summary's row order (ALL-33 AC-6a): bad news first, then the same order every time, whatever
// order the database hands the candidates back in. The real query, claims and email are covered by
// tracking-news.test.ts against the local database (E5); here only the candidates' order changes.

captureLog();

const USER = "00000000-0000-0000-0000-000000000001";
const TODAY = "2030-12-01";

function late(n: number, o: Partial<TrackingCandidate>): TrackingCandidate {
  return {
    userId: USER,
    roundId: `00000000-0000-0000-0000-0000000001${n}0`,
    orderId: `00000000-0000-0000-0000-0000000002${n}0`,
    personName: "Mary",
    occasionKind: "christmas",
    occasionDate: "2030-12-25",
    title: "Gift",
    status: "shipped",
    estDeliveryDate: "2030-12-28",
    placedAt: null,
    handlingDaysMax: null,
    deliveryDaysMax: null,
    refundCents: 3450,
    failureType: null,
    resolved: false,
    store: null,
    sentSteps: new Set<StepKey>(),
    ...o,
  };
}

async function newsText(candidates: TrackingCandidate[]): Promise<string> {
  const notifyStore = new FakeStore();
  notifyStore.recipients.set(USER, { email: "buyer@example.com", timezone: null });
  const texts: string[] = [];
  const channel: Channel = { name: "email", send: async (e) => (texts.push(e.text), { ok: true as const, id: "m1" }) };
  const sent = new Set<string>();
  const store = {
    trackingCandidates: async () => candidates,
    recordSend: async (roundId: string, _userId: string, step: StepKey) => !sent.has(`${roundId}/${step}`) && Boolean(sent.add(`${roundId}/${step}`)),
    forgetSend: async (roundId: string, step: StepKey) => void sent.delete(`${roundId}/${step}`),
  } as unknown as RoundStore;
  await runTrackingNews({
    store,
    notify: { store: notifyStore, channels: [channel], baseUrl: "https://giftsaf.test", now: new Date(`${TODAY}T12:00:00Z`) },
    today: TODAY,
    setting: async () => 1,
  });
  return texts[0];
}

async function summaryRows(candidates: TrackingCandidate[]): Promise<string[]> {
  return (await newsText(candidates)).split("\n").filter((l) => l.startsWith("- ")).map((l) => l.replace(/ \(.*$/, ""));
}

it("one cancelled gift names its store as people read it", async () => {
  const cancelled = { status: "failed", failureType: "store_cancelled", resolved: true, title: "Lamp" } as const;
  expect(await newsText([late(1, { ...cancelled, store: "etsy.com" })])).toContain("Etsy cancelled the Lamp");
  expect(await newsText([late(2, { ...cancelled, store: "amazon" })])).toContain("Amazon cancelled the Lamp");
});

describe("the daily summary's row order", () => {
  const cancel = late(4, { status: "failed", failureType: "store_cancelled", resolved: true, title: "Lamp" });
  const candidates = [
    late(1, { title: "Zebra mug", occasionDate: "2030-12-25", personName: "Mary" }),
    late(2, { title: "Apron", occasionDate: "2030-12-25", personName: "Mary" }),
    late(3, { title: "Blanket", occasionDate: "2030-12-10", personName: "Tom" }),
    cancel,
    late(5, { title: "Candle", occasionDate: "2030-12-25", personName: "Anne" }),
  ];
  const expected = [
    "- Blanket may arrive late",
    "- Candle may arrive late",
    "- Apron may arrive late",
    "- Zebra mug may arrive late",
    "- The store cancelled the Lamp",
  ];

  it("bad news first, then by occasion date, person and gift, whatever order the candidates come in", async () => {
    expect(await summaryRows(candidates)).toEqual(expected);
    expect(await summaryRows([...candidates].reverse())).toEqual(expected);
  });
});
