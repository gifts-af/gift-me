import { Activity } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MySizes } from "@/lib/account-sizes";
import type { MyList } from "@/modules/lists";
import { showSizesRow, sizesRowText } from "../rows";
import type { SizesResult } from "../sizes-actions";
import { SizesForm } from "../sizes-form";

// jsdom has no ResizeObserver, which Radix's Switch uses inside a form.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const NOTE = "Optional. Shared ones are shown to anyone with your list link when they go to claim a gift.";
const EMPTY = { top: null, pants: null, dress: null, shoe: null, ring: null, hat: null, color: null };
const items = (part: Partial<Record<keyof typeof EMPTY, { value: string; shared: boolean }>>) => ({ ...EMPTY, ...part });

function setup(props: Partial<Parameters<typeof SizesForm>[0]> = {}) {
  const save = vi.fn<(form: FormData) => Promise<SizesResult>>(async () => ({ ok: true }));
  const remove = vi.fn<() => Promise<SizesResult>>(async () => ({ ok: true }));
  const ui = (p: typeof props) => <SizesForm saved={EMPTY} on saveAction={save} removeAction={remove} {...props} {...p} />;
  const { rerender } = render(ui({}));
  return { save, remove, update: (p: typeof props) => rerender(ui(p)) };
}
const button = (name: string) => screen.queryByRole("button", { name });

describe("SizesForm", () => {
  it("shows seven boxes in order, each with a Share switch, and the note (AC-2)", () => {
    setup();
    expect(screen.getByText(NOTE)).toBeVisible();
    const labels = screen.getAllByRole("textbox").map((el) => el.id);
    expect(labels).toEqual(["top", "pants", "dress", "shoe", "ring", "hat", "color"].map((k) => `size-${k}`));
    expect(screen.getByLabelText("Shirt or top")).toBeVisible();
    expect(screen.getByLabelText("Favorite color")).toBeVisible();
    expect(screen.getAllByRole("switch")).toHaveLength(7);
    expect(button("Remove all")).toBeNull();
  });

  it("disables Share while its box is empty, and clears it when emptied (AC-3)", async () => {
    setup({ saved: items({ top: { value: "M", shared: true } }) });
    const share = screen.getByRole("switch", { name: "Share Shirt or top" });
    expect(share).toBeEnabled();
    expect(share).toBeChecked();
    expect(screen.getByRole("switch", { name: "Share Pants" })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Shirt or top"));
    expect(share).toBeDisabled();
    expect(share).not.toBeChecked();
  });

  it("saves values and switches, and shows Saved (AC-3)", async () => {
    const t = setup();
    await userEvent.type(screen.getByLabelText("Shoe"), "9.5");
    await userEvent.click(screen.getByRole("switch", { name: "Share Shoe" }));
    await userEvent.click(button("Save")!);
    const sent = t.save.mock.calls[0][0];
    expect(sent.get("shoe")).toBe("9.5");
    expect(sent.get("shoe_shared")).toBe("on");
    expect(sent.get("top_shared")).toBeNull();
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("shows why a save was refused, per box, and a thrown one (AC-3)", async () => {
    const t = setup();
    t.save.mockResolvedValueOnce({ ok: false, error: "Fix the highlighted boxes.", fieldErrors: { ring: "Use 30 characters or fewer." } });
    await userEvent.click(button("Save")!);
    expect(await screen.findByText("Use 30 characters or fewer.")).toBeVisible();
    expect(screen.getByLabelText("Ring")).toBeInvalid();
    t.save.mockRejectedValueOnce(new Error("network"));
    await userEvent.click(button("Save")!);
    expect(await screen.findByText("That didn't save. Try again.")).toBeVisible();
  });

  it("removes everything and empties the boxes", async () => {
    const t = setup({ saved: items({ top: { value: "M", shared: false } }) });
    t.remove.mockImplementationOnce(async () => {
      t.update({ saved: EMPTY }); // the action's revalidation
      return { ok: true };
    });
    await userEvent.click(button("Remove all")!);
    expect(await screen.findByText("Removed")).toBeVisible();
    expect(screen.getByLabelText("Shirt or top")).toHaveValue("");
    expect(button("Remove all")).toBeNull();
    expect(screen.getByText("Removed")).toHaveFocus();
  });

  it("keeps everything and says so when a remove fails", async () => {
    const t = setup({ saved: items({ top: { value: "M", shared: false } }) });
    t.remove.mockResolvedValueOnce({ ok: false, error: "That didn't work. Try again." });
    await userEvent.click(button("Remove all")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't work. Try again.");
    expect(screen.getByLabelText("Shirt or top")).toHaveValue("M");
  });

  it("shows what's saved, not an abandoned edit, when the page is shown again", async () => {
    const ui = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <SizesForm saved={items({ top: { value: "M", shared: false } })} on saveAction={vi.fn(async () => ({ ok: true as const }))} removeAction={vi.fn()} />
      </Activity>
    );
    const { rerender } = render(ui("visible"));
    await userEvent.type(screen.getByLabelText("Shirt or top"), "L");
    rerender(ui("hidden"));
    rerender(ui("visible"));
    expect(screen.getByLabelText("Shirt or top")).toHaveValue("M");
  });

  it("offers only Remove all when the feature is off (AC-10)", () => {
    setup({ saved: items({ top: { value: "M", shared: false } }), on: false });
    expect(button("Remove all")).toBeVisible();
    expect(button("Save")).toBeNull();
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(screen.queryByLabelText("Shirt or top")).toBeNull();
  });
});

const loaded = (part: Parameters<typeof items>[0]): MySizes => ({ status: "loaded", items: items(part) });
const m = { value: "M", shared: false };
const mShared = { value: "M", shared: true };

describe("sizesRowText (AC-1)", () => {
  it.each([
    [loaded({}), "Not added"],
    [loaded({ top: m, pants: m, shoe: m }), "3 saved, none shared"],
    [loaded({ top: mShared, pants: m, shoe: m }), "3 saved, 1 shared"],
    [loaded({ top: mShared, pants: mShared, shoe: mShared }), "3 shared"],
    [{ status: "unavailable" } as MySizes, "Couldn't load"],
  ])("%j reads %s", (s, text) => expect(sizesRowText(s)).toBe(text));
});

describe("showSizesRow (AC-1, AC-10)", () => {
  const base: MyList = { user: { email: "sam@example.test" }, list: null, items: [], loadError: null };
  const withList: MyList = { ...base, list: { id: "l", title: "My list", shareToken: "t", version: "v" } };
  const failed: MyList = { ...base, loadError: "Couldn't load" };
  const none = loaded({});
  const unavailable: MySizes = { status: "unavailable" };
  const saved = loaded({ top: m });
  it.each([
    ["a list", none, withList, true, true],
    ["a list, sizes not readable", unavailable, withList, true, true],
    ["a list that failed to load", none, failed, true, true],
    ["no list", none, base, true, false],
    ["no list, sizes not readable", unavailable, base, true, false],
    ["no list, but one saved", saved, base, true, true],
    ["a list, feature off", none, withList, false, false],
    ["one saved, feature off", saved, withList, false, true],
  ])("%s", (_, sizes, list, on, shown) => expect(showSizesRow(sizes, list, on)).toBe(shown));
});
