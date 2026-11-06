import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountAddressResult, Sharing } from "@/lib/account-address";
import { ShareAddressSwitch } from "../share-address-switch";

const ZINC = "The person ordering may be able to see your full address in their Zinc account.";

function setup(sharing: Sharing, results: { save?: AccountAddressResult; set?: AccountAddressResult } = {}) {
  const saveAction = vi.fn(async (f: FormData) => {
    void f;
    return results.save ?? ({ ok: true } as const);
  });
  const setSharingAction = vi.fn(async (on: boolean) => {
    void on;
    return results.set ?? ({ ok: true } as const);
  });
  const view = render(<ShareAddressSwitch sharing={sharing} saveAction={saveAction} setSharingAction={setSharingAction} />);
  return { saveAction, setSharingAction, view };
}
const toggle = () => screen.getByRole("switch", { name: "Let people with my list ship gifts to me" });

describe("ShareAddressSwitch", () => {
  it("off: the switch and the exact wording", () => {
    setup({ kind: "off", city: "Columbus", state: "OH" });
    expect(toggle()).not.toBeChecked();
    expect(screen.getByText(`Anyone with your list link can see your city and state in GiftsAF. ${ZINC}`)).toBeInTheDocument();
  });

  it("on: names the city and state, and links to the address", () => {
    setup({ kind: "on", city: "Columbus", state: "OH" });
    expect(toggle()).toBeChecked();
    expect(screen.getByText(new RegExp(`^They see Columbus, OH in GiftsAF\\. ${ZINC}`))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change my address" })).toHaveAttribute("href", "/settings#my-address");
  });

  it("turning on with an address calls the action (AC-7)", async () => {
    const { setSharingAction } = setup({ kind: "off", city: "Columbus", state: "OH" });
    await userEvent.click(toggle());
    await waitFor(() => expect(setSharingAction).toHaveBeenCalledWith(true));
  });

  it("turning off calls the action (AC-8)", async () => {
    const { setSharingAction } = setup({ kind: "on", city: "Columbus", state: "OH" });
    await userEvent.click(toggle());
    await waitFor(() => expect(setSharingAction).toHaveBeenCalledWith(false));
  });

  it("a stale page shows the message, and the switch follows the saved state (AC-10)", async () => {
    setup({ kind: "off", city: "Columbus", state: "OH" }, { set: { ok: false, error: "Add your address first." } });
    await userEvent.click(toggle());
    expect(await screen.findByRole("alert")).toHaveTextContent("Add your address first.");
    expect(toggle()).not.toBeChecked();
  });

  it("the switch's state comes from what's saved, including when the page returns", () => {
    const { view, saveAction, setSharingAction } = setup({ kind: "off", city: "Columbus", state: "OH" });
    view.rerender(
      <ShareAddressSwitch sharing={{ kind: "on", city: "Columbus", state: "OH" }} saveAction={saveAction} setSharingAction={setSharingAction} />,
    );
    expect(toggle()).toBeChecked();
  });

  it("with no address, turning on asks once and sends the share flag (AC-9)", async () => {
    const { saveAction, setSharingAction } = setup({ kind: "none" });
    await userEvent.click(toggle());
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Where should gifts ship?" })).toBeInTheDocument();
    expect(within(dialog).getByText("Saving this turns sharing on.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save and share" }));
    await waitFor(() => expect(saveAction).toHaveBeenCalled());
    expect(saveAction.mock.calls[0][0].get("share")).toBe("1");
    expect(setSharingAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a bad field keeps the dialog open (AC-9)", async () => {
    setup({ kind: "none" }, { save: { ok: false, error: "Check the address below.", fields: { city: "Add a city." } } });
    await userEvent.click(toggle());
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save and share" }));
    expect(await within(dialog).findByText("Add a city.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Cancel saves nothing and leaves the switch off (AC-9)", async () => {
    const { saveAction, setSharingAction } = setup({ kind: "none" });
    await userEvent.click(toggle());
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(saveAction).not.toHaveBeenCalled();
    expect(setSharingAction).not.toHaveBeenCalled();
    expect(toggle()).not.toBeChecked();
  });

  it("shows nothing when the read failed (AC-23)", () => {
    const { view } = setup({ kind: "unavailable" });
    expect(view.container).toBeEmptyDOMElement();
  });
});
