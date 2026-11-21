// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddResult } from "../AddResult";

vi.mock("../../lib/config", () => ({ config: { appOrigin: "https://app.test" } }));

afterEach(cleanup);

const gift = { name: "YETI Rambler 20 oz Tumbler", priceCents: 3500 };
const noop = () => {};

describe("AddResult", () => {
  it("added: green banner with the gift, what it means, See your list and Done", async () => {
    const onDone = vi.fn();
    render(<AddResult result={{ outcome: "added" }} gift={gift} busy={false} onAddAnyway={noop} onDontAdd={noop} onDone={onDone} />);
    expect(screen.getByRole("status")).toHaveTextContent("Added to your list");
    expect(screen.getByRole("status")).toHaveTextContent("YETI Rambler 20 oz Tumbler · $35.00");
    expect(screen.getByText("People who have your list link can see it now.")).toBeInTheDocument();
    const list = screen.getByRole("link", { name: "See your list" });
    expect(list).toHaveAttribute("href", "https://app.test/lists");
    expect(list).toHaveAttribute("target", "_blank");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("already there: says so and that nothing was added twice", () => {
    render(<AddResult result={{ outcome: "duplicate" }} gift={gift} busy={false} onAddAnyway={noop} onDontAdd={noop} onDone={noop} />);
    expect(screen.getByRole("status")).toHaveTextContent("Already on your list");
    expect(screen.getByRole("status")).toHaveTextContent("YETI Rambler 20 oz Tumbler · $35.00");
    expect(screen.getByText("This link is on your list already, so nothing was added twice.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See your list" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("likely: shows the gift already there and asks Add anyway or Don't add", async () => {
    const onAddAnyway = vi.fn();
    const onDontAdd = vi.fn();
    render(
      <AddResult
        result={{ outcome: "likely", existing: { name: "Rambler Tumbler", priceCents: 3000, imageUrl: "https://cdn.test/p.jpg" } }}
        gift={gift}
        busy={false}
        onAddAnyway={onAddAnyway}
        onDontAdd={onDontAdd}
        onDone={noop}
      />,
    );
    expect(screen.getByText("This looks like a gift already on your list")).toBeInTheDocument();
    expect(screen.getByText("Rambler Tumbler")).toBeInTheDocument();
    expect(screen.getByText("$30.00")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Rambler Tumbler" })).toHaveAttribute("src", "https://cdn.test/p.jpg");
    await userEvent.click(screen.getByRole("button", { name: "Add anyway" }));
    expect(onAddAnyway).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Don't add" }));
    expect(onDontAdd).toHaveBeenCalled();
  });

  it("full: says the list is full, with See your list and Done", () => {
    render(<AddResult result={{ outcome: "full" }} gift={gift} busy={false} onAddAnyway={noop} onDontAdd={noop} onDone={noop} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Your list is full");
    expect(screen.getByRole("link", { name: "See your list" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });
});
