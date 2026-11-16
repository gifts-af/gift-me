import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  getClaims: vi.fn(),
  saveMyAddress: vi.fn(),
  removeMyAddress: vi.fn(),
  setSharing: vi.fn(),
  startConnect: vi.fn(),
  disconnectZinc: vi.fn(),
  zincWiring: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: m.getClaims } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/account-address", () => ({
  parseMyAddressForm: () => ({ ok: true, value: {} }),
  saveMyAddress: m.saveMyAddress,
  removeMyAddress: m.removeMyAddress,
  setSharing: m.setSharing,
}));
vi.mock("@/modules/concierge", () => ({ startConnect: m.startConnect, disconnectZinc: m.disconnectZinc }));
vi.mock("../zinc-deps", () => ({ placeHeld: vi.fn(), zincWiring: m.zincWiring }));

import { removeMyAddressAction, saveMyAddressAction, setSharingAction } from "../address-actions";
import { disconnectZincAccount, startZincConnect } from "../actions";

const paths = () => m.revalidatePath.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  m.getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } } });
});

describe("address actions revalidate the address page (ALL-115)", () => {
  it("save", async () => {
    m.saveMyAddress.mockResolvedValue(true);
    await saveMyAddressAction(new FormData());
    expect(paths()).toEqual(expect.arrayContaining(["/settings", "/settings/address", "/lists"]));
  });
  it("remove", async () => {
    m.removeMyAddress.mockResolvedValue(true);
    await removeMyAddressAction();
    expect(paths()).toContain("/settings/address");
  });
  it("sharing", async () => {
    m.setSharing.mockResolvedValue("ok");
    await setSharingAction(true);
    expect(paths()).toContain("/settings/address");
  });
});

describe("Zinc actions revalidate the list and the paying page (ALL-115)", () => {
  it("connect", async () => {
    m.zincWiring.mockResolvedValue({ deps: {}, walletUrl: "" });
    m.startConnect.mockResolvedValue({ ok: true });
    await startZincConnect();
    expect(paths()).toEqual(expect.arrayContaining(["/settings", "/settings/paying"]));
  });
  it("disconnect", async () => {
    m.zincWiring.mockResolvedValue(null);
    m.disconnectZinc.mockResolvedValue({ ok: true });
    await disconnectZincAccount();
    expect(paths()).toEqual(expect.arrayContaining(["/settings", "/settings/paying"]));
  });
});
