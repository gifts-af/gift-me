import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CATEGORY_GROUPS } from "@gifts-af/core";

// "Add something" on What we know (ALL-186): the words and a kind, saved as a new fact.

const hydrated = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/use-hydrated", () => ({ useHydrated: () => hydrated.value }));

import { AddFact } from "../know/add-fact";

type Result = { ok: true } | { ok: false; error: string };

beforeEach(() => {
  hydrated.value = true;
});

function setup(result: Result = { ok: true }) {
  const action = vi.fn(async (...a: [unknown, FormData]) => (void a, result));
  render(<AddFact personId="p1" action={action} />);
  return { action, user: userEvent.setup() };
}

const box = () => screen.getByRole("textbox", { name: "Add something" });
const kind = () => screen.getByRole("combobox", { name: "Kind" });
const add = () => screen.getByRole("button", { name: "Add" });
const sent = (fn: { mock: { calls: [unknown, FormData][] } }) => Object.fromEntries(fn.mock.calls[0][1].entries());

describe("AddFact", () => {
  it("has a box with an example, and every kind, starting on Interests", () => {
    setup();
    expect(box()).toHaveAttribute("placeholder", expect.stringMatching(/^Loves pottery, size M/));
    expect(kind()).toHaveValue("interest");
    expect([...(kind() as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(CATEGORY_GROUPS.map((g) => g.label));
  });

  it("sends the words and the kind picked, then empties the box and says Added", async () => {
    const { action, user } = setup();
    await user.type(box(), "size M tops");
    await user.selectOptions(kind(), "size");
    await user.click(add());
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(sent(action)).toEqual({ personId: "p1", value: "size M tops", category: "size" });
    expect(await screen.findByRole("status")).toHaveTextContent("Added");
    expect(box()).toHaveValue("");
    expect(kind()).toHaveValue("interest");
  });

  it("adds on Enter", async () => {
    const { action, user } = setup();
    await user.type(box(), "loves pottery{Enter}");
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(sent(action)).toMatchObject({ value: "loves pottery", category: "interest" });
  });

  it("sends nothing for an empty box, and says why", async () => {
    const { action, user } = setup();
    await user.type(box(), "   ");
    await user.click(add());
    expect(screen.getByRole("alert")).toHaveTextContent("Type something first.");
    expect(action).not.toHaveBeenCalled();
  });

  it("keeps the words and says why when it's refused", async () => {
    const { user } = setup({ ok: false, error: "That's already on their profile." });
    await user.type(box(), "tea");
    await user.click(add());
    expect(await screen.findByRole("alert")).toHaveTextContent("That's already on their profile.");
    expect(box()).toHaveValue("tea");
    expect(screen.queryByText("Added")).toBeNull();
  });

  it("keeps the fields off until the page can save (ALL-110)", () => {
    hydrated.value = false;
    setup();
    expect(box()).toBeDisabled();
    expect(add()).toBeDisabled();
  });
});
