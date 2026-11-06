import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MyAddress } from "@/lib/account-address";
import { MyAddressSection } from "../my-address";

const ADDRESS = { firstName: "Sam", lastName: "Rivera", line1: "44 Elm St", line2: "Apt 2", city: "Columbus", state: "OH", zip: "43215" };
const NOTE = "Only you can see this here. It's used only if you let people with your list ship gifts to you.";
const saved = (shared: boolean): MyAddress => ({ kind: "saved", address: ADDRESS, shared });

function setup(address: MyAddress) {
  const saveAction = vi.fn(async (f: FormData) => {
    void f;
    return { ok: true as const };
  });
  const removeAction = vi.fn(async () => ({ ok: true as const }));
  render(<MyAddressSection address={address} saveAction={saveAction} removeAction={removeAction} />);
  return { saveAction, removeAction };
}

describe("MyAddressSection", () => {
  it("with no address: the note and an Add button, no fields (AC-1)", () => {
    setup({ kind: "none" });
    expect(screen.getByRole("heading", { name: "My address" })).toBeInTheDocument();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add my address" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("the form's name fields start empty, and saving closes it (AC-2)", async () => {
    const { saveAction } = setup({ kind: "none" });
    await userEvent.click(screen.getByRole("button", { name: "Add my address" }));
    expect(screen.getByLabelText("First name")).toHaveValue("");
    expect(screen.getByLabelText("Last name")).toHaveValue("");
    await userEvent.click(screen.getByRole("button", { name: "Save address" }));
    await waitFor(() => expect(saveAction).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
  });

  it("saved, not shared: the card and a link to the list", () => {
    setup(saved(false));
    expect(screen.getByText("Sam Rivera")).toBeInTheDocument();
    expect(screen.getByText("44 Elm St, Apt 2")).toBeInTheDocument();
    expect(screen.getByText("Columbus, OH 43215")).toBeInTheDocument();
    expect(screen.getByText(/^Not shared\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change this on your list." })).toHaveAttribute("href", "/lists");
  });

  it("saved, shared: says so", () => {
    setup(saved(true));
    expect(screen.getByText(/^Shared with people who have your list\./)).toBeInTheDocument();
  });

  it("Change address opens the form with the saved values, and saving never sends a share flag (AC-3)", async () => {
    const { saveAction } = setup(saved(true));
    await userEvent.click(screen.getByRole("button", { name: "Change address" }));
    expect(screen.getByLabelText("City")).toHaveValue("Columbus");
    await userEvent.click(screen.getByRole("button", { name: "Save address" }));
    await waitFor(() => expect(saveAction).toHaveBeenCalled());
    expect(saveAction.mock.calls[0][0].get("share")).toBeNull();
  });

  it("Remove, not shared: plain wording, and Cancel calls nothing (AC-5)", async () => {
    const { removeAction } = setup(saved(false));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Remove your address?" })).toBeInTheDocument();
    expect(within(dialog).getByText("Past orders keep the address they shipped to.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(removeAction).not.toHaveBeenCalled();
  });

  it("Remove, shared: warns that sharing has to be turned on again (AC-5)", async () => {
    const { removeAction } = setup(saved(true));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "People with your list won't be able to ship gifts to you until you add it and turn sharing on again. Past orders keep the address they shipped to.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove address" }));
    await waitFor(() => expect(removeAction).toHaveBeenCalled());
  });

  it("a failed read never looks like having no address (AC-23)", () => {
    setup({ kind: "unavailable" });
    expect(screen.getByText("We couldn't load your address. Try again.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add my address" })).not.toBeInTheDocument();
  });
});
