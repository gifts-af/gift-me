import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DisplayNameField } from "../display-name-field";

const field = () => screen.getByRole("textbox", { name: "Your name" });

// ALL-136: Settings shows and edits the name a shared list shows.
describe("DisplayNameField", () => {
  it("shows the saved name and saves a change on blur", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(<DisplayNameField initial="Aaron" action={action} />);
    expect(field()).toHaveValue("Aaron");
    fireEvent.change(field(), { target: { value: "Aaron A." } });
    await act(async () => fireEvent.blur(field()));
    expect(action).toHaveBeenCalledWith("Aaron A.");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("starts empty with no name, and says what it's for", () => {
    render(<DisplayNameField initial={null} action={vi.fn()} />);
    expect(field()).toHaveValue("");
    expect(field()).toHaveAccessibleDescription("Shown on your shared list, and to anyone who opens a list you claim from.");
  });

  it("shows the error when it can't save", async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, error: "Keep your name to 80 characters." });
    render(<DisplayNameField initial={null} action={action} />);
    fireEvent.change(field(), { target: { value: "x" } });
    await act(async () => fireEvent.blur(field()));
    expect(screen.getByRole("alert")).toHaveTextContent("Keep your name to 80 characters.");
  });
});
