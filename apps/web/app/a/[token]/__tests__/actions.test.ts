import { expect, it, vi } from "vitest";

// Confirming an email link that files a note: its read's cost is written with the service role.

const { confirmActionLink, costRecorder, createAdminClient, recorder } = vi.hoisted(() => ({
  confirmActionLink: vi.fn(),
  costRecorder: vi.fn(),
  createAdminClient: vi.fn(() => ({})),
  recorder: async () => {},
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: async () => ({ data: null }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/modules/concierge", () => ({
  captureStoreFor: vi.fn(),
  confirmActionLink,
  costRecorder,
  createSupabaseInboundStore: vi.fn(),
  createSupabaseNotifyStore: vi.fn(),
  defaultChannels: () => [],
}));

import { confirmLink } from "../actions";

it("gives file_note a recorder on the admin client (ALL-144 AC-13)", async () => {
  costRecorder.mockReturnValue(recorder);
  confirmActionLink.mockResolvedValue({ state: "done" });
  await confirmLink("tok");
  const { notes } = confirmActionLink.mock.calls[0][2];
  expect(notes()).toMatchObject({ recordCost: recorder });
  expect(costRecorder).toHaveBeenCalledWith(createAdminClient);
});
