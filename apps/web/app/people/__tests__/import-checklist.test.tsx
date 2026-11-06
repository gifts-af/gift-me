import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { GoogleContact } from "@gifts-af/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it, onTestFinished, vi } from "vitest";
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
  // ALL-104: the button is in the server's HTML, and a tap before the page's
  // JavaScript has loaded does nothing, so it stays off until then.
  it("keeps Connect off in the server's HTML, then the first tap after loading works", async () => {
    const load = vi.fn(async () => CONTACTS);
    const ui = <ImportChecklist action={vi.fn()} imported={[]} load={load} />;
    const container = document.body.appendChild(document.createElement("div"));
    onTestFinished(() => container.remove());
    container.innerHTML = renderToString(ui);
    const button = () => within(container).getByRole("button", { name: "Connect Google Contacts" });
    expect(button()).toBeDisabled();

    await act(async () => {
      render(ui, { container, hydrate: true });
    });
    expect(button()).toBeEnabled();

    await connect();
    expect(load).toHaveBeenCalledOnce();
    expect(screen.getByRole("checkbox", { name: /Alex Kim/ })).toBeInTheDocument();
  });

  it("asks Google for nothing until the buyer chooses to connect (AC-1)", async () => {
    const { load } = setup();
    expect(load).not.toHaveBeenCalled();
    await connect();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("lists contacts A to Z and finds them by name (AC-2)", async () => {
    setup();
    await connect();
    const names = screen.getAllByRole("checkbox", { name: /Kim|Allen|Lee/ }).map((c) => c.getAttribute("aria-label"));
    expect(names).toEqual(["Alex Kim", "Jane Allen", "Sam Lee"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search your contacts" }), { target: { value: "jan" } });
    expect(screen.getAllByRole("checkbox", { name: /Kim|Allen|Lee/ })).toHaveLength(1);
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
    expect(screen.getByRole("link", { name: "See them on Give" })).toHaveAttribute("href", "/");
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
    expect(screen.getAllByRole("checkbox", { name: /Kim|Allen|Lee/ })).toHaveLength(3);
  });

  it("says when there are no contacts to show", async () => {
    setup({ load: async () => [] });
    await connect();
    expect(screen.getByText("Google didn't send any contacts with names.")).toBeInTheDocument();
  });

  // ALL-72: a disabled Add must say why, and lead to the row that needs a pick.
  it("names the ticked contact still missing a relationship, and takes you to it", async () => {
    setup();
    await connect();
    fireEvent.click(screen.getByRole("checkbox", { name: "Jane Allen" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Sam Lee" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick who Sam Lee is to you" }));
    expect(within(row("Sam Lee")).getByRole("combobox")).toHaveFocus();
  });

  it("counts several missing relationships, and says nothing once all are picked", async () => {
    setup();
    await connect();
    fireEvent.click(screen.getByRole("checkbox", { name: "Alex Kim" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Sam Lee" }));
    expect(screen.getByRole("button", { name: "Pick who 2 people are to you" })).toBeInTheDocument();
    fireEvent.change(within(row("Alex Kim")).getByRole("combobox"), { target: { value: "friend" } });
    fireEvent.change(within(row("Sam Lee")).getByRole("combobox"), { target: { value: "friend" } });
    expect(screen.queryByRole("button", { name: /^Pick who/ })).not.toBeInTheDocument();
  });

  it("can show just the ticked contacts", async () => {
    setup();
    await connect();
    const contactBoxes = () => screen.getAllByRole("checkbox", { name: /Kim|Allen|Lee/ });
    expect(screen.getByRole("checkbox", { name: "Show ticked (0)" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Sam Lee" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show ticked (1)" }));
    expect(contactBoxes().map((c) => c.getAttribute("aria-label"))).toEqual(["Sam Lee"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Sam Lee" }));
    expect(screen.getByRole("checkbox", { name: "Show ticked (0)" })).not.toBeChecked();
    expect(contactBoxes()).toHaveLength(3);
  });
});
