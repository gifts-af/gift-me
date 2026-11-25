import { Activity } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SaveResult } from "@/modules/concierge";
import type { MyList } from "@/modules/lists";
import { BirthdayForm } from "../birthday-form";
import { birthdayRowText, showBirthdayRow } from "../rows";

const NOTE =
  "Optional. Anyone signed in with your list link can see this when they add you. People who already added it keep it.";

function setup(props: Partial<Parameters<typeof BirthdayForm>[0]> = {}) {
  const save = vi.fn<(form: FormData) => Promise<SaveResult>>(async () => ({ ok: true }));
  const remove = vi.fn<() => Promise<SaveResult>>(async () => ({ ok: true }));
  const ui = (p: typeof props) => <BirthdayForm saved={null} on saveAction={save} removeAction={remove} {...props} {...p} />;
  const { rerender } = render(ui({}));
  return { save, remove, update: (p: typeof props) => rerender(ui(p)) };
}
const button = (name: string) => screen.queryByRole("button", { name });

describe("BirthdayForm", () => {
  it("says who sees it, and asks no year (AC-3)", () => {
    setup();
    expect(screen.getByText(NOTE)).toBeVisible();
    expect(screen.queryByLabelText(/year/i)).toBeNull();
    expect(button("Remove")).toBeNull();
  });

  it("saves the month and day (AC-2)", async () => {
    const t = setup();
    await userEvent.selectOptions(screen.getByLabelText("Birthday month"), "March");
    await userEvent.type(screen.getByLabelText("Birthday day"), "14");
    await userEvent.click(button("Save")!);
    expect(t.save.mock.calls[0][0].get("birthdayMonth")).toBe("3");
    expect(t.save.mock.calls[0][0].get("birthdayDay")).toBe("14");
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("shows why a save was refused, and a thrown one (AC-2)", async () => {
    const t = setup();
    t.save.mockResolvedValueOnce({ ok: false, error: "Pick a month and a day." });
    await userEvent.click(button("Save")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Pick a month and a day.");
    t.save.mockRejectedValueOnce(new Error("network"));
    await userEvent.click(button("Save")!);
    expect(await screen.findByText("That didn't save. Try again.")).toBeVisible();
  });

  it("removes it and empties the fields (AC-4)", async () => {
    const t = setup({ saved: { month: 3, day: 14 } });
    t.remove.mockImplementationOnce(async () => {
      t.update({ saved: null }); // the action's revalidation
      return { ok: true };
    });
    expect(screen.getByLabelText("Birthday month")).toHaveValue("3");
    await userEvent.click(button("Remove")!);
    expect(t.remove).toHaveBeenCalledOnce();
    expect(await screen.findByText("Removed")).toBeVisible();
    expect(screen.getByLabelText("Birthday month")).toHaveValue("");
    expect(button("Remove")).toBeNull();
    expect(screen.getByText("Removed")).toHaveFocus();
  });

  it("keeps the birthday and says so when a remove fails (AC-4)", async () => {
    const t = setup({ saved: { month: 3, day: 14 } });
    t.remove.mockResolvedValueOnce({ ok: false, error: "That didn't work. Try again." });
    await userEvent.click(button("Remove")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't work. Try again.");
    expect(screen.getByLabelText("Birthday month")).toHaveValue("3");
    expect(button("Remove")).toBeVisible();
  });

  it("can't be edited while saving", async () => {
    const t = setup({ saved: { month: 3, day: 14 } });
    let finish!: (r: SaveResult) => void;
    t.save.mockReturnValueOnce(new Promise((r) => (finish = r)));
    await userEvent.click(button("Save")!);
    expect(screen.getByLabelText("Birthday day")).toBeDisabled();
    finish({ ok: true });
    expect(await screen.findByText("Saved")).toBeVisible();
    expect(screen.getByLabelText("Birthday day")).toBeEnabled();
  });

  it("shows what's saved, not an abandoned edit, when the page is shown again", async () => {
    const ui = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <BirthdayForm saved={{ month: 3, day: 14 }} on saveAction={vi.fn(async () => ({ ok: true as const }))} removeAction={vi.fn()} />
      </Activity>
    );
    const { rerender } = render(ui("visible"));
    await userEvent.click(button("Save")!);
    await screen.findByText("Saved");
    await userEvent.selectOptions(screen.getByLabelText("Birthday month"), "April");
    rerender(ui("hidden"));
    rerender(ui("visible"));
    expect(screen.getByLabelText("Birthday month")).toHaveValue("3");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("offers only Remove when the feature is off (AC-10)", () => {
    setup({ saved: { month: 3, day: 14 }, on: false });
    expect(button("Remove")).toBeVisible();
    expect(button("Save")).toBeNull();
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});

describe("birthdayRowText (AC-1)", () => {
  it.each([
    [{ kind: "saved", month: 3, day: 14 } as const, "Mar 14"],
    [{ kind: "none" } as const, "Not added"],
    [{ kind: "unavailable" } as const, "Couldn't load"],
  ])("%j reads %s", (b, text) => expect(birthdayRowText(b)).toBe(text));
});

describe("showBirthdayRow (AC-1, AC-10)", () => {
  const base: MyList = { user: { email: "sam@example.test" }, list: null, items: [], loadError: null };
  const withList: MyList = { ...base, list: { id: "l", title: "My list", shareToken: "t", version: "v" } };
  const failed: MyList = { ...base, loadError: "Couldn't load" };
  const none = { kind: "none" } as const;
  const unavailable = { kind: "unavailable" } as const;
  const saved = { kind: "saved", month: 3, day: 14 } as const;
  it.each([
    ["a list", none, withList, true, true],
    ["a list, birthday not readable", unavailable, withList, true, true],
    ["a list that failed to load", none, failed, true, true],
    ["no list", none, base, true, false],
    ["no list, birthday not readable", unavailable, base, true, false],
    ["no list, but one saved", saved, base, true, true],
    ["a list, feature off", none, withList, false, false],
    ["one saved, feature off", saved, withList, false, true],
  ])("%s", (_, birthday, list, on, shown) => expect(showBirthdayRow(birthday, list, on)).toBe(shown));
});
