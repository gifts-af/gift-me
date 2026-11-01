import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeletePerson } from "../delete-person";

// Stands in for Next: rethrows its redirect errors, ignores anything else.
vi.mock("next/navigation", () => ({
  unstable_rethrow: (e: unknown) => {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
  },
}));

function setup(result: { ok: true } | { ok: false; error: string } | Error = { ok: true }) {
  const action = vi.fn(async (...a: [unknown, FormData]) => {
    void a;
    if (result instanceof Error) throw result;
    return result;
  });
  render(<DeletePerson personId="p1" name="Dad" action={action} />);
  return action;
}

describe("DeletePerson", () => {
  it("asks to confirm and deletes nothing yet", async () => {
    const action = setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete Dad" }));
    expect(await screen.findByText("Delete Dad?")).toBeInTheDocument();
    expect(screen.getByText("This removes them from GiftsAF.")).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });

  it("Cancel closes without deleting", async () => {
    const action = setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete Dad" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Delete Dad?")).not.toBeInTheDocument());
    expect(action).not.toHaveBeenCalled();
  });

  it("Delete sends the person's id", async () => {
    const action = setup(new Error("NEXT_REDIRECT"));
    await userEvent.click(screen.getByRole("button", { name: "Delete Dad" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(action.mock.calls[0][1].get("id")).toBe("p1");
  });

  it("shows no error and stays busy when the action redirects Home", async () => {
    setup(new Error("NEXT_REDIRECT"));
    await userEvent.click(screen.getByRole("button", { name: "Delete Dad" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("shows an error and re-enables Delete when the action really fails", async () => {
    setup(new Error("network down"));
    await userEvent.click(screen.getByRole("button", { name: "Delete Dad" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't go through. Try again.");
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("stays and shows the error when it fails", async () => {
    setup({ ok: false, error: "That couldn't be saved. Try again." });
    await userEvent.click(screen.getByRole("button", { name: "Delete Dad" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That couldn't be saved. Try again.");
  });
});
