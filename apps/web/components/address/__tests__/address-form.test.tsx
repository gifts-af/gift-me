import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddressForm, type AddressValues } from "../address-form";

const EMPTY: AddressValues = { firstName: "", lastName: "", line1: "", line2: "", city: "", state: "", zip: "" };

describe("AddressForm", () => {
  it("shows the label it's given", () => {
    render(<AddressForm start={EMPTY} submitLabel="Save and share" save={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Save and share" })).toBeInTheDocument();
    expect(screen.getByText("US addresses only for now.")).toBeInTheDocument();
  });

  it("sends the fields, then finishes on success", async () => {
    const save = vi.fn(async (f: FormData) => {
      void f;
      return { ok: true as const };
    });
    const onDone = vi.fn();
    render(<AddressForm start={{ ...EMPTY, firstName: "Sam" }} submitLabel="Save address" save={save} onDone={onDone} />);
    await userEvent.type(screen.getByLabelText("City"), "Columbus");
    await userEvent.click(screen.getByRole("button", { name: "Save address" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const sent = save.mock.calls[0][0];
    expect(sent.get("firstName")).toBe("Sam");
    expect(sent.get("city")).toBe("Columbus");
  });

  it("shows each bad field's message and keeps what was typed", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "Check the address below.", fields: { zip: "Enter a 5-digit ZIP code." } }));
    const onDone = vi.fn();
    render(<AddressForm start={EMPTY} submitLabel="Save address" save={save} onDone={onDone} />);
    await userEvent.type(screen.getByLabelText("ZIP code"), "123");
    await userEvent.click(screen.getByRole("button", { name: "Save address" }));
    expect(await screen.findByText("Enter a 5-digit ZIP code.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Check the address below.");
    expect(screen.getByLabelText("ZIP code")).toHaveValue("123");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("says to try again when saving throws", async () => {
    const save = vi.fn(async () => {
      throw new Error("network");
    });
    render(<AddressForm start={EMPTY} submitLabel="Save address" save={save} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Save address" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't save. Try again.");
  });

  it("keeps each form's labels on its own fields when two are in the page, as with a hidden route", () => {
    const { container } = render(
      <>
        <AddressForm start={EMPTY} submitLabel="One" save={vi.fn()} onDone={vi.fn()} />
        <AddressForm start={EMPTY} submitLabel="Two" save={vi.fn()} onDone={vi.fn()} />
      </>,
    );
    const [first, second] = Array.from(container.querySelectorAll("form"));
    for (const form of [first, second]) {
      const label = Array.from(form.querySelectorAll("label")).find((l) => l.textContent === "City");
      expect(form.contains(label?.control ?? null)).toBe(true);
    }
  });

  it("posts if submitted before the page is ready, so an address never lands in a URL", () => {
    const { container } = render(<AddressForm start={EMPTY} submitLabel="One" save={vi.fn()} onDone={vi.fn()} />);
    expect(container.querySelector("form")).toHaveAttribute("method", "post");
  });

  it("shows starting errors, for an address that needs fixing", () => {
    render(
      <AddressForm start={EMPTY} startErrors={{ state: "Pick a state." }} submitLabel="Save address" save={vi.fn()} onDone={vi.fn()} />,
    );
    expect(screen.getByText("Pick a state.")).toBeInTheDocument();
  });
});
