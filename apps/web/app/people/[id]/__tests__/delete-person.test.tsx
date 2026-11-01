import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeletePerson } from "../delete-person";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function setup(result: { ok: true } | { ok: false; error: string } = { ok: true }) {
  const action = vi.fn(async (...a: [unknown, FormData]) => (void a, result));
  render(<DeletePerson personId="p1" name="Dad" action={action} />);
  return action;
}

describe("DeletePerson", () => {
  beforeEach(() => push.mockClear());

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

  it("Delete removes the person and goes Home", async () => {
    const action = setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete Dad" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(action.mock.calls[0][1].get("id")).toBe("p1");
  });

  it("stays and shows the error when it fails", async () => {
    setup({ ok: false, error: "That couldn't be saved. Try again." });
    await userEvent.click(screen.getByRole("button", { name: "Delete Dad" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That couldn't be saved. Try again.");
    expect(push).not.toHaveBeenCalled();
  });
});
