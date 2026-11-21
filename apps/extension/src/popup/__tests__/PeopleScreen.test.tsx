// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { PeopleScreen, type Person } from "../PeopleScreen";

vi.mock("../../lib/supabase", () => ({ getSupabase: () => ({}) }));

afterEach(cleanup);

const people: Person[] = [
  { id: "p-a", name: "Aunt Carol" },
  { id: "p-b", name: "Ben" },
  { id: "p-d", name: "Dad" },
  { id: "p-j", name: "Jimmy" },
  { id: "p-m", name: "Mom" },
];
const recent = [people[3], people[4], people[2]];

function Harness({ top, autoFocusSearch = false, list = people }: { top?: ReactNode; autoFocusSearch?: boolean; list?: Person[] }) {
  const [selected, setSelected] = useState<Person | null>(null);
  const [note, setNote] = useState("");
  return (
    <PeopleScreen
      top={top}
      people={list}
      recent={recent}
      selectedId={selected?.id ?? null}
      onSelect={setSelected}
      onAdded={setSelected}
      autoFocusSearch={autoFocusSearch}
      note={note}
      onNoteChange={setNote}
      saveLabel={selected ? `Save to ${selected.name}` : "Save"}
      moneyNotice={null}
      canSave={selected !== null}
      busy={false}
      error={null}
      onSave={() => {}}
    />
  );
}

const listNames = () =>
  within(screen.getByRole("list", { name: "People" }))
    .getAllByRole("button")
    .map((b) => b.textContent);

describe("PeopleScreen", () => {
  it("recent people first, marked recent, then the rest by name; picking one names the Save button", async () => {
    render(<Harness top={<p>No product on this page.</p>} />);
    expect(listNames()).toEqual(["Jimmyrecent", "Momrecent", "Dadrecent", "Aunt Carol", "Ben"]);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Aunt Carol" }));
    expect(screen.getByRole("button", { name: "Aunt Carol" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Save to Aunt Carol" })).toBeEnabled();
    expect(screen.getByText("No product on this page.")).toBeInTheDocument();
  });

  it("search narrows the list straight away and can be focused on open", async () => {
    render(<Harness autoFocusSearch />);
    const search = screen.getByLabelText("Search people");
    expect(search).toHaveFocus();
    await userEvent.type(search, "mo");
    expect(listNames()).toEqual(["Momrecent"]);
    await userEvent.clear(search);
    await userEvent.type(search, "zz");
    expect(screen.getByText("No one matches “zz”.")).toBeInTheDocument();
  });

  it("has the note box and Add a person; with no people the add form is open", async () => {
    render(<Harness />);
    expect(screen.getByLabelText("Note (optional)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add a person" }));
    expect(screen.getByLabelText("Relationship")).toBeInTheDocument();
    cleanup();
    render(<Harness list={[]} />);
    expect(screen.getByLabelText("Relationship")).toBeInTheDocument();
  });
});
