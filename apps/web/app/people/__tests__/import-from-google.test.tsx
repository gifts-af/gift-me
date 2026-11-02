import { act, fireEvent, render, screen } from "@testing-library/react";
import { Activity } from "react";
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

  // The import's server action refreshes the page, so the imported list
  // changes while the result is on screen: the result must stay.
  it("keeps the result when the page refreshes with the new people", async () => {
    const { rerender } = render(<ImportFromGoogle clientId="id" imported={[]} action={action} />);
    await importSam();
    rerender(<ImportFromGoogle clientId="id" imported={["people/c1"]} action={action} />);
    expect(screen.getByRole("status")).toHaveTextContent("Added 1 person");
  });

  // Next.js keeps a page you leave in a hidden <Activity>; coming back shows it again.
  it("starts fresh when you leave the page and come back", async () => {
    const page = (mode: "visible" | "hidden", imported: string[]) => (
      <Activity mode={mode}>
        <ImportFromGoogle clientId="id" imported={imported} action={action} />
      </Activity>
    );
    const { rerender } = render(page("visible", []));
    await importSam();
    await act(async () => rerender(page("hidden", ["people/c1"])));
    await act(async () => rerender(page("visible", ["people/c1"])));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Connect Google Contacts" })));
    expect(screen.getByRole("checkbox", { name: "Sam Lee" })).toBeDisabled();
  });
});
