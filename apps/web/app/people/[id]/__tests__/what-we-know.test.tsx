import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Result = { ok: true } | { ok: false; error: string };

const confirmFactAction = vi.hoisted(() => vi.fn(async (...a: [unknown, FormData]) => (void a, { ok: true } as Result)));
vi.mock("../../actions", () => ({ confirmFactAction: (...a: [unknown, FormData]) => confirmFactAction(...a) }));
const hydrated = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/use-hydrated", () => ({ useHydrated: () => hydrated.value }));

import { WhatWeKnow, type Knowledge } from "../what-we-know";

const ok = { ok: true } as const;

beforeEach(() => {
  confirmFactAction.mockClear();
  hydrated.value = true;
});

const fact = (over: Partial<Knowledge["off"][number]> & { id: string; value: string }): Knowledge["off"][number] => ({
  category: "interest",
  source: "question",
  sourceId: null,
  confirmed: true,
  sourceLabel: "You answered",
  sourceTitle: null,
  sourceUrl: null,
  ...over,
});

const aiFact = fact({
  id: "f1",
  category: "wants",
  value: "a rotary vise",
  source: "capture",
  confirmed: false,
  sourceLabel: "✨ AI suggestion",
  sourceTitle: "Instagram",
  sourceUrl: "https://www.instagram.com/p/x",
});
const askedFact = fact({ id: "f2", value: "fly fishing" });

const knowledge = (over: Partial<Knowledge> = {}): Knowledge => ({
  groups: [
    { category: "interest", label: "Interests", facts: [askedFact] },
    { category: "wants", label: "Wants", facts: [aiFact] },
  ],
  off: [],
  unread: 0,
  captureRead: { estimateCents: 2 },
  ...over,
});

function setup(k: Knowledge = knowledge(), questionsHref: string | null = "/people/p1/questions") {
  const actions = {
    editAction: vi.fn(async (...a: [unknown, FormData]) => (void a, ok as Result)),
    setActiveAction: vi.fn(async (...a: [unknown, FormData]) => (void a, ok as Result)),
    deleteAction: vi.fn(async (...a: [unknown, FormData]) => (void a, ok as Result)),
    readAction: vi.fn(async (...a: [unknown, FormData]) => (void a, ok as Result)),
  };
  const view = render(<WhatWeKnow personId="p1" name="Dad" knowledge={k} questionsHref={questionsHref} {...actions} />);
  const rerender = (next: Knowledge) =>
    view.rerender(<WhatWeKnow personId="p1" name="Dad" knowledge={next} questionsHref={questionsHref} {...actions} />);
  return { ...actions, rerender };
}

/** The fields one call of an action sent. */
const sent = (fn: { mock: { calls: [unknown, FormData][] } }, call = 0) => Object.fromEntries(fn.mock.calls[call][1].entries());

describe("WhatWeKnow", () => {
  it("groups facts by category, each with its source (AC-7)", () => {
    setup();
    const interests = screen.getByRole("region", { name: "Interests" });
    expect(within(interests).getByText("fly fishing")).toBeInTheDocument();
    expect(within(interests).getByText("You answered")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Wants" })).getByText("a rotary vise")).toBeInTheDocument();
  });

  it("marks an AI suggestion and links to where it came from (D47)", () => {
    setup();
    const wants = screen.getByRole("region", { name: "Wants" });
    expect(within(wants).getByText("✨ AI suggestion")).toBeInTheDocument();
    const link = within(wants).getByRole("link", { name: /Instagram/ });
    expect(link).toHaveAttribute("href", "https://www.instagram.com/p/x");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("points to the questions when there's nothing yet", () => {
    setup(knowledge({ groups: [] }));
    expect(screen.getByText(/Nothing yet/)).toBeInTheDocument();
  });

  it("opens a fact in place when it's tapped, with no Save button (ALL-127)", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByLabelText("Fact")).not.toBeInTheDocument();
    const open = screen.getByRole("button", { name: "fly fishing" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    await user.click(open);
    expect(open).toHaveAttribute("aria-expanded", "true");
    const row = open.closest("li")!;
    expect(within(row).getByLabelText("Fact")).toHaveValue("fly fishing");
    expect(within(row).getByLabelText("Kind")).toHaveValue("interest");
    expect(within(row).getByRole("switch", { name: "Use for gift ideas" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn off" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Fact")).not.toBeInTheDocument();
  });

  it("saves the text on leaving the field, with the category, and says Saved (AC-9)", async () => {
    const user = userEvent.setup();
    const { editAction } = setup();
    await user.click(screen.getByRole("button", { name: "fly fishing" }));
    const value = screen.getByLabelText("Fact");
    await user.clear(value);
    await user.type(value, "dry-fly fishing");
    expect(editAction).not.toHaveBeenCalled();
    await user.tab();
    await waitFor(() => expect(editAction).toHaveBeenCalledOnce());
    expect(sent(editAction)).toEqual({ personId: "p1", id: "f2", value: "dry-fly fishing", category: "interest" });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });

  it("saves the text on Enter", async () => {
    const user = userEvent.setup();
    const { editAction } = setup();
    await user.click(screen.getByRole("button", { name: "fly fishing" }));
    await user.type(screen.getByLabelText("Fact"), " trips{Enter}");
    await waitFor(() => expect(editAction).toHaveBeenCalledOnce());
    expect(sent(editAction).value).toBe("fly fishing trips");
  });

  it("sends nothing when the text didn't change", async () => {
    const user = userEvent.setup();
    const { editAction } = setup();
    await user.click(screen.getByRole("button", { name: "fly fishing" }));
    await user.click(screen.getByLabelText("Fact"));
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(editAction).not.toHaveBeenCalled();
  });

  it("saves typed text when the fact is closed", async () => {
    const user = userEvent.setup();
    const { editAction } = setup();
    await user.click(screen.getByRole("button", { name: "fly fishing" }));
    await user.type(screen.getByLabelText("Fact"), " trips");
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(editAction).toHaveBeenCalledOnce());
    expect(sent(editAction).value).toBe("fly fishing trips");
  });

  it("saves the category when picked, and a later text save keeps it (AC-9)", async () => {
    const user = userEvent.setup();
    const { editAction } = setup();
    await user.click(screen.getByRole("button", { name: "fly fishing" }));
    await user.selectOptions(screen.getByLabelText("Kind"), "brand");
    await waitFor(() => expect(editAction).toHaveBeenCalledOnce());
    expect(sent(editAction, 0)).toMatchObject({ value: "fly fishing", category: "brand" });
    const value = screen.getByLabelText("Fact");
    await user.clear(value);
    await user.type(value, "Orvis");
    await user.tab();
    await waitFor(() => expect(editAction).toHaveBeenCalledTimes(2));
    expect(sent(editAction, 1)).toMatchObject({ value: "Orvis", category: "brand" });
  });

  it("keeps an open fact where it is when its category moves it, until Done", async () => {
    const user = userEvent.setup();
    const { rerender } = setup();
    await user.click(screen.getByRole("button", { name: "fly fishing" }));
    await user.selectOptions(screen.getByLabelText("Kind"), "brand");
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
    // The server's fresh page: the fact is now under Brands.
    rerender(
      knowledge({
        groups: [
          { category: "wants", label: "Wants", facts: [aiFact] },
          { category: "brand", label: "Brands", facts: [{ ...askedFact, category: "brand" }] },
        ],
      }),
    );
    const interests = screen.getByRole("region", { name: "Interests" });
    expect(within(interests).getByLabelText("Fact")).toHaveValue("fly fishing");
    expect(within(interests).getByLabelText("Kind")).toHaveValue("brand");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.queryByRole("region", { name: "Brands" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("region", { name: "Interests" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Brands" })).getByText("fly fishing")).toBeInTheDocument();
  });

  it("shows an error for empty text and sends nothing", async () => {
    const user = userEvent.setup();
    const { editAction } = setup();
    await user.click(screen.getByRole("button", { name: "fly fishing" }));
    const value = screen.getByLabelText("Fact");
    await user.clear(value);
    await user.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent("Type something first.");
    expect(editAction).not.toHaveBeenCalled();
    expect(value).toHaveValue("");
  });

  it("keeps the text and says why when a save is refused (AC-9)", async () => {
    const user = userEvent.setup();
    const { editAction } = setup();
    editAction.mockResolvedValueOnce({ ok: false, error: "Try wording it another way." });
    await user.click(screen.getByRole("button", { name: "fly fishing" }));
    const value = screen.getByLabelText("Fact");
    await user.clear(value);
    await user.type(value, "church");
    await user.tab();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Try wording it another way.");
    expect(value).toHaveValue("church");
    // In the open fact, where a phone is looking, not at the end of the section.
    expect(value.closest("li")).toContainElement(alert);
    expect(screen.getByRole("status")).not.toHaveTextContent("Saved");
  });

  it("saves the Use for gift ideas switch when it's flipped (AC-9)", async () => {
    const user = userEvent.setup();
    const { setActiveAction } = setup();
    await user.click(screen.getByRole("button", { name: "fly fishing" }));
    await user.click(screen.getByRole("switch", { name: "Use for gift ideas" }));
    await waitFor(() => expect(setActiveAction).toHaveBeenCalledOnce());
    expect(sent(setActiveAction)).toEqual({ personId: "p1", id: "f2", active: "false" });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });

  it("shows a failed switch's message", async () => {
    const user = userEvent.setup();
    const { setActiveAction } = setup();
    setActiveAction.mockResolvedValueOnce({ ok: false, error: "That didn't go through." });
    await user.click(screen.getByRole("button", { name: "fly fishing" }));
    await user.click(screen.getByRole("switch", { name: "Use for gift ideas" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't go through.");
  });

  it("keeps a fact that was just turned off open, so it can be turned back on", async () => {
    const user = userEvent.setup();
    const { rerender, setActiveAction } = setup();
    await user.click(screen.getByRole("button", { name: "fly fishing" }));
    await user.click(screen.getByRole("switch", { name: "Use for gift ideas" }));
    await waitFor(() => expect(setActiveAction).toHaveBeenCalledOnce());
    rerender(knowledge({ groups: [{ category: "wants", label: "Wants", facts: [aiFact] }], off: [askedFact] }));
    expect(screen.queryByText("Turned off (1)")).not.toBeInTheDocument();
    const sw = within(screen.getByRole("region", { name: "Interests" })).getByRole("switch", { name: "Use for gift ideas" });
    expect(sw).not.toBeChecked();
    await user.click(sw);
    await waitFor(() => expect(setActiveAction).toHaveBeenCalledTimes(2));
    expect(sent(setActiveAction, 1).active).toBe("true");
  });

  it("asks before deleting, and says a capture could bring it back (AC-4)", async () => {
    const user = userEvent.setup();
    const { deleteAction } = setup();
    await user.click(screen.getByRole("button", { name: "fly fishing" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteAction).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/A later capture could suggest it again/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete for good" }));
    await waitFor(() => expect(deleteAction).toHaveBeenCalledOnce());
    expect(deleteAction.mock.calls[0][1].get("id")).toBe("f2");
  });

  it("offers Looks right only on an unconfirmed AI fact, and confirms it (AC-10)", async () => {
    const user = userEvent.setup();
    const { editAction } = setup();
    await user.click(screen.getByRole("button", { name: "fly fishing" }));
    expect(screen.queryByRole("button", { name: "Looks right" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "a rotary vise" }));
    await user.click(screen.getByRole("button", { name: "Looks right" }));
    await waitFor(() => expect(confirmFactAction).toHaveBeenCalledOnce());
    expect(sent(confirmFactAction)).toEqual({ personId: "p1", id: "f1" });
    expect(editAction).not.toHaveBeenCalled();
  });

  it("doesn't offer Looks right on a confirmed capture", async () => {
    const user = userEvent.setup();
    setup(knowledge({ groups: [{ category: "wants", label: "Wants", facts: [{ ...aiFact, confirmed: true, sourceLabel: "From a capture" }] }] }));
    await user.click(screen.getByRole("button", { name: "a rotary vise" }));
    expect(screen.getByLabelText("Fact")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Looks right" })).not.toBeInTheDocument();
  });

  it("shows a failed Looks right's message in the open fact", async () => {
    const user = userEvent.setup();
    setup();
    confirmFactAction.mockResolvedValueOnce({ ok: false, error: "That didn't go through. Try again." });
    await user.click(screen.getByRole("button", { name: "a rotary vise" }));
    await user.click(screen.getByRole("button", { name: "Looks right" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That didn't go through. Try again.");
    expect(screen.getByLabelText("Fact").closest("li")).toContainElement(alert);
  });

  it("keeps the fields off until the page can save (ALL-110)", async () => {
    hydrated.value = false;
    const user = userEvent.setup();
    setup();
    const open = screen.getByRole("button", { name: "fly fishing" });
    expect(open).toHaveAttribute("aria-disabled", "true");
    await user.click(open);
    expect(screen.getByLabelText("Fact")).toBeDisabled();
    expect(screen.getByLabelText("Kind")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Use for gift ideas" })).toHaveAttribute("aria-disabled", "true");
  });

  it("lists turned-off facts apart, and turns one back on (AC-5)", async () => {
    const user = userEvent.setup();
    const { setActiveAction } = setup(knowledge({ off: [fact({ id: "f3", value: "golf" })] }));
    expect(screen.getByText("Turned off (1)")).toBeInTheDocument();
    await user.click(screen.getByText("Turned off (1)"));
    await user.click(screen.getByRole("button", { name: "Turn on golf" }));
    await waitFor(() => expect(setActiveAction).toHaveBeenCalledOnce());
    expect(setActiveAction.mock.calls[0][1].get("active")).toBe("true");
  });

  it("deletes a turned-off fact without turning it on first (AC-4)", async () => {
    const user = userEvent.setup();
    const { deleteAction, setActiveAction } = setup(knowledge({ off: [fact({ id: "f3", value: "golf" })] }));
    await user.click(screen.getByText("Turned off (1)"));
    await user.click(screen.getByRole("button", { name: "Delete golf" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete for good" }));
    await waitFor(() => expect(deleteAction).toHaveBeenCalledOnce());
    expect(deleteAction.mock.calls[0][1].get("id")).toBe("f3");
    expect(setActiveAction).not.toHaveBeenCalled();
  });

  it("offers to read unread captures", async () => {
    const user = userEvent.setup();
    const { readAction } = setup(knowledge({ unread: 2 }));
    expect(screen.getByText("2 captures haven't been read.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Read them now" }));
    await waitFor(() => expect(readAction).toHaveBeenCalledOnce());
    expect(readAction.mock.calls[0][1].get("personId")).toBe("p1");
  });

  it("with paid features, shows the money notice next to Read it now (ALL-94)", () => {
    setup(knowledge({ unread: 1 }));
    expect(screen.getByRole("button", { name: "Read it now" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      "We read each capture with AI, which costs real money: about 2¢ each.",
    );
  });

  it("without paid features, doesn't offer reading and says why (ALL-94)", () => {
    setup(knowledge({ unread: 1, captureRead: null }));
    expect(screen.getByText("1 capture hasn't been read.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Read it now" })).not.toBeInTheDocument();
    expect(
      screen.getByText("Reading captures costs real money, so for now it's only on for test accounts."),
    ).toBeInTheDocument();
  });

  it("says nothing about money when nothing is waiting to be read (ALL-94)", () => {
    setup(knowledge({ unread: 0 }));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
