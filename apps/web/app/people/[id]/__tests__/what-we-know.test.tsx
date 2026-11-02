import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WhatWeKnow, type Knowledge } from "../what-we-know";

const ok = { ok: true } as const;

const empty: Knowledge = { told: [], ai: [], unread: 0 };
const withAi: Knowledge = {
  told: [],
  ai: [
    {
      id: "f1",
      category: "wants",
      value: "a new rotary fly-tying vise",
      sourceTitle: "Instagram",
      sourceUrl: "https://www.instagram.com/p/x",
    },
    { id: "f2", category: "owns", value: "Owala water bottle", sourceTitle: null, sourceUrl: null },
  ],
  unread: 0,
};

function setup(knowledge: Knowledge) {
  const remove = vi.fn(async (...a: [unknown, FormData]) => (void a, ok));
  const read = vi.fn(async (...a: [unknown, FormData]) => (void a, ok));
  render(<WhatWeKnow personId="p1" name="Dad" knowledge={knowledge} removeAction={remove} readAction={read} />);
  return { remove, read };
}

describe("WhatWeKnow", () => {
  it("lists AI facts under their own heading, with where they came from", () => {
    setup(withAi);
    const group = screen.getByRole("region", { name: /AI suggestions from your captures/ });
    expect(within(group).getByText("Wants: a new rotary fly-tying vise")).toBeInTheDocument();
    expect(within(group).getByText("Already has: Owala water bottle")).toBeInTheDocument();
    const link = within(group).getByRole("link", { name: /Instagram/ });
    expect(link).toHaveAttribute("href", "https://www.instagram.com/p/x");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("hides What you've told us while it's empty", () => {
    setup(withAi);
    expect(screen.queryByText("What you've told us")).not.toBeInTheDocument();
  });

  it("shows facts the buyer entered apart from the AI's", () => {
    setup({ ...withAi, told: [{ id: "t1", category: "size", value: "large shirt" }] });
    const told = screen.getByRole("region", { name: "What you've told us" });
    expect(within(told).getByText("Size: large shirt")).toBeInTheDocument();
    expect(within(told).queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("removes a fact", async () => {
    const { remove } = setup(withAi);
    await userEvent.click(screen.getByRole("button", { name: "Remove Wants: a new rotary fly-tying vise" }));
    await waitFor(() => expect(remove).toHaveBeenCalled());
    const form = remove.mock.calls[0][1];
    expect([form.get("id"), form.get("personId")]).toEqual(["f1", "p1"]);
  });

  it("says how to start when nothing is known", () => {
    setup(empty);
    expect(screen.getByText("Nothing yet. Capture a page about Dad with the extension and we'll learn from it.")).toBeInTheDocument();
  });

  it("offers to read one unread capture", async () => {
    const { read } = setup({ ...withAi, unread: 1 });
    expect(screen.getByText("1 capture hasn't been read.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Read it now" }));
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(read.mock.calls[0][1].get("personId")).toBe("p1");
  });

  it("uses the plural for more than one", () => {
    setup({ ...empty, unread: 2 });
    expect(screen.getByText("2 captures haven't been read.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read them now" })).toBeInTheDocument();
  });

  it("shows an error from Read now", async () => {
    const remove = vi.fn(async () => ok);
    const read = vi.fn(async () => ({ ok: false as const, error: "Couldn't read them. Try again." }));
    render(<WhatWeKnow personId="p1" name="Dad" knowledge={{ ...empty, unread: 1 }} removeAction={remove} readAction={read} />);
    await userEvent.click(screen.getByRole("button", { name: "Read it now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't read them. Try again.");
  });
});
