import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WhatWeKnow, type Knowledge } from "../what-we-know";

const ok = { ok: true } as const;

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
    editAction: vi.fn(async (...a: [unknown, FormData]) => (void a, ok as { ok: true } | { ok: false; error: string })),
    setActiveAction: vi.fn(async (...a: [unknown, FormData]) => (void a, ok)),
    deleteAction: vi.fn(async (...a: [unknown, FormData]) => (void a, ok)),
    readAction: vi.fn(async (...a: [unknown, FormData]) => (void a, ok)),
  };
  render(<WhatWeKnow personId="p1" name="Dad" knowledge={k} questionsHref={questionsHref} {...actions} />);
  return actions;
}

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

  it("edits a fact's value and category (AC-6)", async () => {
    const user = userEvent.setup();
    const { editAction } = setup();
    await user.click(screen.getByRole("button", { name: "Edit fly fishing" }));
    const value = screen.getByLabelText("Fact");
    await user.clear(value);
    await user.type(value, "dry-fly fishing");
    await user.selectOptions(screen.getByLabelText("Kind"), "brand");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(editAction).toHaveBeenCalledOnce());
    const form = editAction.mock.calls[0][1];
    expect(form.get("id")).toBe("f2");
    expect(form.get("value")).toBe("dry-fly fishing");
    expect(form.get("category")).toBe("brand");
    expect(form.get("personId")).toBe("p1");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument());
  });

  it("keeps the text and says why when an edit is refused (AC-8)", async () => {
    const user = userEvent.setup();
    const { editAction } = setup();
    editAction.mockResolvedValueOnce({ ok: false, error: "Try wording it another way." } as never);
    await user.click(screen.getByRole("button", { name: "Edit fly fishing" }));
    const value = screen.getByLabelText("Fact");
    await user.clear(value);
    await user.type(value, "church");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Try wording it another way.");
    expect(value).toHaveValue("church");
    // In the open editor, where a phone is looking, not at the end of the section.
    expect(value.closest("li")).toContainElement(alert);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("turns a fact off (AC-5)", async () => {
    const user = userEvent.setup();
    const { setActiveAction } = setup();
    await user.click(screen.getByRole("button", { name: "Edit fly fishing" }));
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(setActiveAction).toHaveBeenCalledOnce());
    const form = setActiveAction.mock.calls[0][1];
    expect(form.get("id")).toBe("f2");
    expect(form.get("active")).toBe("false");
  });

  it("asks before deleting, and says a capture could bring it back (AC-4)", async () => {
    const user = userEvent.setup();
    const { deleteAction } = setup();
    await user.click(screen.getByRole("button", { name: "Edit fly fishing" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteAction).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/A later capture could suggest it again/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete for good" }));
    await waitFor(() => expect(deleteAction).toHaveBeenCalledOnce());
    expect(deleteAction.mock.calls[0][1].get("id")).toBe("f2");
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

  it("shows a failed action's message", async () => {
    const user = userEvent.setup();
    const { setActiveAction } = setup();
    setActiveAction.mockResolvedValueOnce({ ok: false, error: "That didn't go through." } as never);
    await user.click(screen.getByRole("button", { name: "Edit fly fishing" }));
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't go through.");
  });
});
