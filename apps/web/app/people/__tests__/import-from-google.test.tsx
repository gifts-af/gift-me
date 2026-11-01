import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ImportResult } from "@/modules/concierge";

// ALL-72 AC-4 (found in the owner's live import): after an import finishes,
// you can start over, and coming back to the page never shows the old result.
vi.mock("../import/google-contacts", () => ({
  loadGoogleContacts: vi.fn(async () => [
    { googleId: "people/c1", name: "Sam Lee", firstName: null, lastName: null, nickname: null, birthday: null, address: null, photoUrl: null },
  ]),
}));
const { ImportFromGoogle } = await import("../import/import-from-google");

const action = vi.fn(async (): Promise<ImportResult> => ({ ok: true, added: 1, skipped: 0, failed: 0, photosMissed: 0 }));

async function importSam() {
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Connect Google Contacts" })));
  fireEvent.click(screen.getByRole("checkbox", { name: "Sam Lee" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Who is Sam Lee to you?" }), { target: { value: "friend" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add 1 person" })));
  await screen.findByRole("status");
}

describe("importing again", () => {
  it("starts over from the result with Import more people", async () => {
    render(<ImportFromGoogle clientId="id" imported={[]} action={action} />);
    await importSam();
    fireEvent.click(screen.getByRole("button", { name: "Import more people" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Google Contacts" })).toBeInTheDocument();
  });

  it("starts fresh when the page comes back with new people imported", async () => {
    const { rerender } = render(<ImportFromGoogle clientId="id" imported={[]} action={action} />);
    await importSam();
    rerender(<ImportFromGoogle clientId="id" imported={["people/c1"]} action={action} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Connect Google Contacts" })));
    expect(screen.getByRole("checkbox", { name: "Sam Lee" })).toBeDisabled();
  });
});
