import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AddressSaveResult, PersonAddress, SaveResult } from "@/modules/concierge";
import { AddressSection } from "../address";

const SAVED = {
  firstName: "Mary", lastName: "Smith", line1: "12 Oak Lane", line2: "Apt 3", city: "Tampa", state: "FL", zip: "33602",
};

function setup(
  address: PersonAddress,
  opts: { name?: string; startOpen?: boolean; save?: AddressSaveResult; remove?: SaveResult } = {},
) {
  const saveAction = vi.fn(async (_p: null, f: FormData) => {
    void f;
    return opts.save ?? { ok: true as const };
  });
  const removeAction = vi.fn(async (_p: null, f: FormData) => {
    void f;
    return opts.remove ?? { ok: true as const };
  });
  render(
    <AddressSection
      personId="p1"
      name={opts.name ?? "Mary Jane Smith"}
      address={address}
      startOpen={opts.startOpen ?? false}
      saveAction={saveAction}
      removeAction={removeAction}
    />,
  );
  return { saveAction, removeAction };
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe("AddressSection", () => {
  it("with no address: a quiet note and an Add button, no fields (AC-1)", () => {
    setup({ kind: "none" });
    expect(screen.getByRole("heading", { name: "Shipping address" })).toBeInTheDocument();
    expect(screen.getByText("Optional for now. We'll ask before their first gift ships.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add an address" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Add opens the form with the name split into first and last (AC-3)", async () => {
    setup({ kind: "none" });
    await userEvent.click(screen.getByRole("button", { name: "Add an address" }));
    expect(field("First name").value).toBe("Mary Jane");
    expect(field("Last name").value).toBe("Smith");
    expect(field("Street address").value).toBe("");
    const state = screen.getByLabelText("State") as HTMLSelectElement;
    expect(state.options).toHaveLength(52);
    expect(state.options[0].textContent).toBe("Choose…");
    expect(screen.getByText("US addresses only for now.")).toBeInTheDocument();
  });

  it("starts open when the buyer comes from the address email (AC-8)", () => {
    setup({ kind: "none" }, { startOpen: true });
    expect(field("Street address")).toBeInTheDocument();
  });

  it("Save sends the person and every field, then closes (AC-2)", async () => {
    const { saveAction } = setup({ kind: "none" }, { startOpen: true });
    await userEvent.type(field("Street address"), "12 Oak Lane");
    await userEvent.type(field("Apt, suite (optional)"), "Apt 3");
    await userEvent.type(field("City"), "Tampa");
    await userEvent.selectOptions(screen.getByLabelText("State"), "FL");
    await userEvent.type(field("ZIP code"), "33602");
    await userEvent.click(screen.getByRole("button", { name: "Save address" }));

    const sent = Object.fromEntries(saveAction.mock.calls[0][1].entries());
    expect(sent).toEqual({
      id: "p1", firstName: "Mary Jane", lastName: "Smith", line1: "12 Oak Lane", line2: "Apt 3", city: "Tampa", state: "FL",
      zip: "33602",
    });
    await waitFor(() => expect(screen.queryByLabelText("Street address")).not.toBeInTheDocument());
  });

  it("shows each field's message and keeps what was typed (AC-5)", async () => {
    setup(
      { kind: "none" },
      { startOpen: true, save: { ok: false, error: "Check the address below.", fields: { city: "Add a city.", zip: "Enter a 5-digit ZIP code." } } },
    );
    await userEvent.type(field("Street address"), "12 Oak Lane");
    await userEvent.type(field("ZIP code"), "123");
    await userEvent.click(screen.getByRole("button", { name: "Save address" }));

    expect(await screen.findByText("Add a city.")).toBeInTheDocument();
    expect(field("City")).toHaveAccessibleDescription("Add a city.");
    expect(field("ZIP code")).toHaveAccessibleDescription("Enter a 5-digit ZIP code.");
    expect(screen.getByRole("alert")).toHaveTextContent("Check the address below.");
    expect(field("Street address").value).toBe("12 Oak Lane");
    expect(field("ZIP code").value).toBe("123");
  });

  it("Cancel closes the form without saving", async () => {
    const { saveAction } = setup({ kind: "none" }, { startOpen: true });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Street address")).not.toBeInTheDocument();
    expect(saveAction).not.toHaveBeenCalled();
  });

  it("a saved address shows as a card; Change opens it filled in (AC-4)", async () => {
    setup({ kind: "own", address: SAVED, problems: {} });
    expect(screen.getByText("Mary Smith")).toBeInTheDocument();
    expect(screen.getByText("12 Oak Lane, Apt 3")).toBeInTheDocument();
    expect(screen.getByText("Tampa, FL 33602")).toBeInTheDocument();
    expect(screen.queryByText(/Something's missing/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Change address" }));
    expect(field("First name").value).toBe("Mary");
    expect(field("City").value).toBe("Tampa");
    expect((screen.getByLabelText("State") as HTMLSelectElement).value).toBe("FL");
  });

  it("an incomplete imported address says so, and the form marks what's wrong (AC-10)", async () => {
    setup({
      kind: "own",
      address: { ...SAVED, firstName: null, lastName: null, state: "Florida" },
      problems: { firstName: "Add their first name.", lastName: "Add their last name.", state: "Pick a state." },
    });
    expect(screen.getByText("Something's missing. Change the address to fix it.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Change address" }));
    expect(field("First name")).toHaveAccessibleDescription("Add their first name.");
    expect(screen.getByLabelText("State")).toHaveAccessibleDescription("Pick a state.");
    expect(field("Street address").value).toBe("12 Oak Lane");
  });

  it("Remove asks first; Cancel keeps it (AC-6)", async () => {
    const { removeAction } = setup({ kind: "own", address: SAVED, problems: {} }, { name: "Mom" });
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Remove Mom's address?")).toBeInTheDocument();
    expect(screen.getByText("We'll ask for it again before their next gift.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Remove Mom's address?")).not.toBeInTheDocument());
    expect(removeAction).not.toHaveBeenCalled();
  });

  it("Remove, confirmed, sends the person's id (AC-6)", async () => {
    const { removeAction } = setup({ kind: "own", address: SAVED, problems: {} }, { name: "Mom" });
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove address" }));
    expect(Object.fromEntries(removeAction.mock.calls[0][1].entries())).toEqual({ id: "p1" });
  });

  it("a shared address is read-only: city and state, no buttons or fields (AC-12)", () => {
    setup({ kind: "shared", city: "Tampa", state: "FL" }, { name: "Mom" });
    expect(screen.getByText("Gifts ship to Mom's own address in Tampa, FL. They keep it up to date.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
