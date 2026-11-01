import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { GoogleContact } from "@gifts-af/core";
import { describe, expect, it, vi } from "vitest";
import type { ImportResult } from "@/modules/concierge";
import { ImportChecklist } from "../import/import-checklist";

// ALL-24: the "Who do you buy gifts for?" checklist, with a fake contact
// loader in place of Google's popup and People API.

const contact = (over: Partial<GoogleContact> & { name: string; googleId: string }): GoogleContact => ({
  firstName: null,
  lastName: null,
  nickname: null,
  birthday: null,
  address: null,
  photoUrl: null,
  ...over,
});

const CONTACTS: GoogleContact[] = [
  contact({ googleId: "people/c1", name: "Alex Kim" }),
  contact({
    googleId: "people/c2",
    name: "Jane Allen",
    firstName: "Jane",
    lastName: "Allen",
    nickname: "Mom",
    birthday: { month: 3, day: 14, year: 1960 },
    address: { line1: "1 Elm St", line2: null, city: "Springfield", state: "IL", zip: "62701", country: "US" },
    photoUrl: "https://lh3.googleusercontent.com/cm/A=s100",
  }),
  contact({ googleId: "people/c3", name: "Sam Lee" }),
];

function setup(opts: { imported?: string[]; load?: () => Promise<GoogleContact[]>; result?: ImportResult } = {}) {
  const action = vi.fn<(previous: ImportResult | null, f: FormData) => Promise<ImportResult>>(async () =>
    opts.result ?? { ok: true, added: 1, skipped: 0, failed: 0, photosMissed: 0 });
  const load = vi.fn(opts.load ?? (async () => CONTACTS));
  render(<ImportChecklist action={action} imported={opts.imported ?? []} load={load} />);
  return { action, load };
}

async function connect() {
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Connect Google Contacts" })));
}

const row = (name: string) => screen.getByRole("checkbox", { name: new RegExp(name) }).closest("li")!;

describe("the Google Contacts import checklist", () => {
  it("asks Google for nothing until the buyer chooses to connect (AC-1)", async () => {
    const { load } = setup();
    expect(load).not.toHaveBeenCalled();
    await connect();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("lists contacts A to Z and finds them by name (AC-2)", async () => {
    setup();
    await connect();
    const names = screen.getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"));
    expect(names).toEqual(["Alex Kim", "Jane Allen", "Sam Lee"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search your contacts" }), { target: { value: "jan" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: "Jane Allen" })).toBeInTheDocument();
  });

  it("pre-fills Mom as Mother when she's ticked (AC-4)", async () => {
    setup();
    await connect();
    fireEvent.click(screen.getByRole("checkbox", { name: "Jane Allen" }));
    expect(within(row("Jane Allen")).getByRole("combobox", { name: "Who is Jane Allen to you?" })).toHaveValue("mother");
  });

  it("keeps Import off until every ticked contact has a relationship (AC-5)", async () => {
    setup();
    await connect();
    const add = () => screen.getByRole("button", { name: /^Add/ });
    expect(add()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Sam Lee" }));
    expect(within(row("Sam Lee")).getByText("Pick who they are")).toBeInTheDocument();
    expect(add()).toBeDisabled();
    fireEvent.change(within(row("Sam Lee")).getByRole("combobox"), { target: { value: "friend" } });
    expect(add()).toBeEnabled();
    expect(add()).toHaveTextContent("Add 1 person");
  });

  it("sends only the ticked contacts to the server (AC-9)", async () => {
    const { action } = setup();
    await connect();
    fireEvent.click(screen.getByRole("checkbox", { name: "Jane Allen" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add 1 person" })));
    await waitFor(() => expect(action).toHaveBeenCalled());
    const rows = JSON.parse(String(action.mock.calls[0][1].get("rows")));
    expect(rows).toEqual([
      {
        googleId: "people/c2",
        name: "Jane Allen",
        relationship: "mother",
        birthday: { month: 3, day: 14, year: 1960 },
        address: { firstName: "Jane", lastName: "Allen", line1: "1 Elm St", line2: null, city: "Springfield", state: "IL", zip: "62701", country: "US" },
        photoUrl: "https://lh3.googleusercontent.com/cm/A=s100",
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("Alex");
  });

  it("shows already-imported contacts as added, and they can't be ticked (AC-7)", async () => {
    setup({ imported: ["people/c1"] });
    await connect();
    expect(screen.getByRole("checkbox", { name: "Alex Kim" })).toBeDisabled();
    expect(within(row("Alex Kim")).getByText("Already added")).toBeInTheDocument();
  });

  it("says how it went once the people are added", async () => {
    setup({ result: { ok: true, added: 2, skipped: 1, failed: 0, photosMissed: 1 } });
    await connect();
    fireEvent.click(screen.getByRole("checkbox", { name: "Jane Allen" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add 1 person" })));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Added 2 people");
    expect(status).toHaveTextContent("1 was already added");
    expect(status).toHaveTextContent("1 photo couldn't be copied");
    expect(screen.getByRole("link", { name: "See them on Home" })).toHaveAttribute("href", "/");
  });

  it("says so plainly when Google says no, and can try again (AC-11)", async () => {
    let fail = true;
    setup({
      load: async () => {
        if (fail) throw new Error("popup_closed");
        return CONTACTS;
      },
    });
    await connect();
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't get your contacts from Google.");
    fail = false;
    await connect();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("says when there are no contacts to show", async () => {
    setup({ load: async () => [] });
    await connect();
    expect(screen.getByText("Google didn't send any contacts with names.")).toBeInTheDocument();
  });
});
