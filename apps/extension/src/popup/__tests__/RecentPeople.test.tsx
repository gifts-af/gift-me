// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecentPeople } from "../RecentPeople";

afterEach(cleanup);

const recent = [
  { id: "p-j", name: "Jimmy" },
  { id: "p-m", name: "Mom" },
  { id: "p-d", name: "Dad" },
];

describe("RecentPeople", () => {
  it("shows the divider, one button per recent person, then Someone else…", async () => {
    const onPick = vi.fn();
    const onSomeoneElse = vi.fn();
    render(<RecentPeople people={recent} busy={false} onPick={onPick} onSomeoneElse={onSomeoneElse} />);
    expect(screen.getByText("or save it for someone")).toBeInTheDocument();
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(["Jimmy", "Mom", "Dad", "Someone else…"]);

    await userEvent.click(screen.getByRole("button", { name: "Mom" }));
    expect(onPick).toHaveBeenCalledWith({ id: "p-m", name: "Mom" });
    await userEvent.click(screen.getByRole("button", { name: "Someone else…" }));
    expect(onSomeoneElse).toHaveBeenCalledTimes(1);
  });

  it("while saving, every button is off", () => {
    render(<RecentPeople people={recent} busy onPick={() => {}} onSomeoneElse={() => {}} />);
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
  });
});
