import { describe, expect, it, onTestFinished, vi } from "vitest";
import { Activity } from "react";
import { renderToString } from "react-dom/server";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AboutForm, type AboutActions } from "../about-form";

// About Mom (ALL-127): each field saves on its own (useAutosave). The actions
// are faked; the real ones are covered by the action and service tests and
// e2e/people.spec.ts.

const ok = () => vi.fn(async (...args: unknown[]) => (void args, { ok: true as const }));

function actions(over: Partial<AboutActions> = {}): AboutActions {
  return { rename: ok(), setRelationship: ok(), setDate: ok(), setBirthYear: ok(), removeDate: ok(), ...over };
}

const MOM = {
  personId: "p1",
  name: "Mom",
  relationship: "mother",
  birthday: { month: 3, day: 14 } as { month: number; day: number } | null,
  birthYear: null as number | null,
  anniversary: null as { month: number; day: number } | null,
};

function setup(over: Partial<typeof MOM> = {}, a: AboutActions = actions()) {
  const view = render(<AboutForm {...MOM} {...over} actions={a} />);
  return { ...view, a };
}

const nameField = () => screen.getByRole("textbox", { name: "Name" });
const birthday = () => screen.getByRole("group", { name: "Birthday" });
const anniversary = () => screen.getByRole("group", { name: "Anniversary" });

describe("AboutForm", () => {
  it("shows what's saved", () => {
    setup({ birthYear: 1960, anniversary: { month: 6, day: 5 } });
    expect(nameField()).toHaveValue("Mom");
    expect(screen.getByRole("combobox", { name: "Who are they to you?" })).toHaveValue("mother");
    expect(within(birthday()).getByRole("combobox", { name: "Birthday month" })).toHaveValue("3");
    expect(within(birthday()).getByRole("spinbutton", { name: "Birthday day" })).toHaveValue(14);
    expect(within(birthday()).getByRole("spinbutton", { name: "Birth year (optional)" })).toHaveValue(1960);
    expect(within(anniversary()).getByRole("combobox", { name: "Anniversary month" })).toHaveValue("6");
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
  });

  describe("name", () => {
    it("saves on leaving the field, once, and says Saved", async () => {
      const { a } = setup();
      fireEvent.change(nameField(), { target: { value: "Mama" } });
      await act(async () => fireEvent.blur(nameField()));
      expect(a.rename).toHaveBeenCalledTimes(1);
      expect(a.rename).toHaveBeenCalledWith("p1", "Mama");
      expect(within(screen.getByTestId("name-field")).getByRole("status")).toHaveTextContent("Saved");
      await act(async () => fireEvent.blur(nameField()));
      expect(a.rename).toHaveBeenCalledTimes(1);
    });

    it("saves on Enter", async () => {
      const { a } = setup();
      fireEvent.change(nameField(), { target: { value: "Mama" } });
      await act(async () => fireEvent.keyDown(nameField(), { key: "Enter" }));
      expect(a.rename).toHaveBeenCalledWith("p1", "Mama");
    });

    it("takes at most 120 characters, as the rule does", () => {
      setup();
      expect(nameField()).toHaveAttribute("maxLength", "120");
    });

    it("shows an error for an empty name and sends nothing (AC-3)", async () => {
      const { a } = setup();
      fireEvent.change(nameField(), { target: { value: "  " } });
      await act(async () => fireEvent.blur(nameField()));
      expect(a.rename).not.toHaveBeenCalled();
      expect(within(screen.getByTestId("name-field")).getByRole("alert")).toHaveTextContent("Enter a name.");
      expect(nameField()).toHaveAttribute("aria-invalid", "true");
    });

    it("keeps what was typed when the save fails", async () => {
      const { a } = setup({}, actions({ rename: vi.fn(async () => ({ ok: false as const, error: "That couldn't be saved. Try again." })) }));
      fireEvent.change(nameField(), { target: { value: "Mama" } });
      await act(async () => fireEvent.blur(nameField()));
      expect(a.rename).toHaveBeenCalled();
      expect(nameField()).toHaveValue("Mama");
      expect(screen.getByRole("alert")).toHaveTextContent("That couldn't be saved. Try again.");
    });
  });

  it("saves the relationship when it's picked (AC-4)", async () => {
    const { a } = setup();
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: "Who are they to you?" }), { target: { value: "aunt" } });
    });
    expect(a.setRelationship).toHaveBeenCalledWith("p1", "aunt");
    expect(a.rename).not.toHaveBeenCalled();
  });

  describe("birthday", () => {
    it("saves month and day once, on leaving the date fields, never a date passed through (AC-5)", async () => {
      const { a } = setup();
      const month = within(birthday()).getByRole("combobox", { name: "Birthday month" });
      const day = within(birthday()).getByRole("spinbutton", { name: "Birthday day" });
      const user = userEvent.setup();
      await user.selectOptions(month, "11");
      await user.click(day);
      await user.clear(day);
      await user.type(day, "30");
      expect(a.setDate).not.toHaveBeenCalled();
      await act(async () => user.click(nameField()));
      expect(a.setDate).toHaveBeenCalledTimes(1);
      expect(a.setDate).toHaveBeenCalledWith("p1", "birthday", "11", "30");
      expect(within(birthday()).getByRole("status")).toHaveTextContent("Saved");
    });

    it("shows That date doesn't exist for Feb 31 and sends nothing (AC-6)", async () => {
      const { a } = setup();
      const user = userEvent.setup();
      await user.selectOptions(within(birthday()).getByRole("combobox", { name: "Birthday month" }), "2");
      const day = within(birthday()).getByRole("spinbutton", { name: "Birthday day" });
      await user.clear(day);
      await user.type(day, "31");
      await act(async () => user.click(nameField()));
      expect(a.setDate).not.toHaveBeenCalled();
      expect(within(birthday()).getByRole("alert")).toHaveTextContent("That date doesn't exist.");
    });

    it("saves nothing when the fields are cleared (AC-6)", async () => {
      const { a } = setup();
      const user = userEvent.setup();
      await user.selectOptions(within(birthday()).getByRole("combobox", { name: "Birthday month" }), "");
      await user.clear(within(birthday()).getByRole("spinbutton", { name: "Birthday day" }));
      await act(async () => user.click(nameField()));
      expect(a.setDate).not.toHaveBeenCalled();
      expect(within(birthday()).queryByRole("alert")).toBeNull();
    });

    it("keeps the year off until a date is saved, and saves it on leaving it", async () => {
      const { a } = setup({ birthday: null });
      const year = () => within(birthday()).getByRole("spinbutton", { name: "Birth year (optional)" });
      expect(year()).toBeDisabled();
      const user = userEvent.setup();
      await user.selectOptions(within(birthday()).getByRole("combobox", { name: "Birthday month" }), "4");
      await user.type(within(birthday()).getByRole("spinbutton", { name: "Birthday day" }), "2");
      // A real date in the fields isn't enough: it has to be saved first.
      expect(year()).toBeDisabled();
      await act(async () => user.click(nameField()));
      expect(a.setDate).toHaveBeenCalledWith("p1", "birthday", "4", "2");
      expect(year()).toBeEnabled();
      await user.type(year(), "1960");
      await act(async () => user.click(nameField()));
      expect(a.setBirthYear).toHaveBeenCalledWith("p1", "1960");
    });

    it("keeps the year off when the save fails", async () => {
      setup({ birthday: null }, actions({ setDate: vi.fn(async () => ({ ok: false as const, error: "Nope." })) }));
      const user = userEvent.setup();
      await user.selectOptions(within(birthday()).getByRole("combobox", { name: "Birthday month" }), "4");
      await user.type(within(birthday()).getByRole("spinbutton", { name: "Birthday day" }), "2");
      await act(async () => user.click(nameField()));
      expect(within(birthday()).getByRole("spinbutton", { name: "Birth year (optional)" })).toBeDisabled();
    });

    // Review of PR 1 (blocker): a failed date must never be sent again after a
    // Remove, or it would make a new birthday (and a second round).
    it("never re-sends a failed date after Remove, even when the page goes", async () => {
      const calls: string[] = [];
      const a = actions({
        setDate: vi.fn(async () => (calls.push("setDate"), { ok: false as const, error: "That couldn't be saved. Try again." })),
        removeDate: vi.fn(async () => (calls.push("removeDate"), { ok: true as const })),
      });
      const { unmount } = setup({}, a);
      const user = userEvent.setup();
      await user.selectOptions(within(birthday()).getByRole("combobox", { name: "Birthday month" }), "11");
      const day = within(birthday()).getByRole("spinbutton", { name: "Birthday day" });
      await user.clear(day);
      await user.type(day, "30");
      await act(async () => user.click(nameField()));
      expect(within(birthday()).getByRole("alert")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Remove birthday" }));
      await act(async () => user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove birthday" })));
      await act(async () => user.click(nameField()));
      unmount();
      expect(calls).toEqual(["setDate", "removeDate"]);
    });

    // Review of PR 1: on iPhone, closing the month wheel blurs with no target.
    it("waits a moment after a blur with no target, so a date on the way isn't saved (iPhone)", async () => {
      vi.useFakeTimers();
      try {
        const { a } = setup();
        const month = within(birthday()).getByRole("combobox", { name: "Birthday month" });
        const day = within(birthday()).getByRole("spinbutton", { name: "Birthday day" });
        fireEvent.change(month, { target: { value: "11" } });
        fireEvent.blur(month, { relatedTarget: null });
        await act(async () => vi.advanceTimersByTime(1000));
        fireEvent.focus(day);
        await act(async () => vi.advanceTimersByTime(1000));
        expect(a.setDate).not.toHaveBeenCalled();
        fireEvent.change(day, { target: { value: "30" } });
        await act(async () => fireEvent.blur(day, { relatedTarget: nameField() }));
        await act(async () => vi.advanceTimersByTime(3000));
        expect(a.setDate).toHaveBeenCalledTimes(1);
        expect(a.setDate).toHaveBeenCalledWith("p1", "birthday", "11", "30");
      } finally {
        vi.useRealTimers();
      }
    });

    it("saves after the wait when focus doesn't come back", async () => {
      vi.useFakeTimers();
      try {
        const { a } = setup();
        const month = within(birthday()).getByRole("combobox", { name: "Birthday month" });
        fireEvent.change(month, { target: { value: "11" } });
        fireEvent.blur(month, { relatedTarget: null });
        await act(async () => vi.advanceTimersByTime(1499));
        expect(a.setDate).not.toHaveBeenCalled();
        await act(async () => vi.advanceTimersByTime(1));
        expect(a.setDate).toHaveBeenCalledWith("p1", "birthday", "11", "14");
      } finally {
        vi.useRealTimers();
      }
    });

    it("asks before removing, then removes the birthday and its year (AC-7)", async () => {
      const { a } = setup({ birthYear: 1960 });
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Remove birthday" }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByRole("heading", { name: "Remove Mom's birthday?" })).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(a.removeDate).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Remove birthday" }));
      await act(async () => user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove birthday" })));
      expect(a.removeDate).toHaveBeenCalledWith("p1", "birthday");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(within(birthday()).getByRole("combobox", { name: "Birthday month" })).toHaveValue("");
      expect(within(birthday()).getByRole("spinbutton", { name: "Birth year (optional)" })).toHaveValue(null);
      expect(screen.queryByRole("button", { name: "Remove birthday" })).toBeNull();
      // Leaving the empty fields after a remove sends nothing more.
      await act(async () => user.click(nameField()));
      expect(a.setDate).not.toHaveBeenCalled();
      expect(a.setBirthYear).not.toHaveBeenCalled();
    });

    it("offers no Remove without a birthday", () => {
      setup({ birthday: null });
      expect(screen.queryByRole("button", { name: "Remove birthday" })).toBeNull();
    });
  });

  describe("anniversary", () => {
    it("saves on leaving its fields, and has no year", async () => {
      const { a } = setup();
      expect(within(anniversary()).queryByRole("spinbutton", { name: /year/i })).toBeNull();
      const user = userEvent.setup();
      await user.selectOptions(within(anniversary()).getByRole("combobox", { name: "Anniversary month" }), "6");
      await user.type(within(anniversary()).getByRole("spinbutton", { name: "Anniversary day" }), "5");
      await act(async () => user.click(nameField()));
      expect(a.setDate).toHaveBeenCalledWith("p1", "anniversary", "6", "5");
      expect(screen.queryByRole("button", { name: "Remove anniversary" })).toBeInTheDocument();
    });

    it("removes it behind a confirm", async () => {
      const { a } = setup({ anniversary: { month: 6, day: 5 } });
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Remove anniversary" }));
      await act(async () => user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove anniversary" })));
      expect(a.removeDate).toHaveBeenCalledWith("p1", "anniversary");
      expect(within(anniversary()).getByRole("combobox", { name: "Anniversary month" })).toHaveValue("");
    });

    it("shows the error when removing fails, and keeps the date", async () => {
      const a = actions({ removeDate: vi.fn(async () => ({ ok: false as const, error: "That couldn't be saved. Try again." })) });
      setup({ anniversary: { month: 6, day: 5 } }, a);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Remove anniversary" }));
      await act(async () => user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove anniversary" })));
      expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("That couldn't be saved. Try again.");
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
      expect(within(anniversary()).getByRole("combobox", { name: "Anniversary month" })).toHaveValue("6");
      expect(screen.getByRole("button", { name: "Remove anniversary" })).toBeInTheDocument();
    });
  });

  it("saves a pending date when the page is hidden, and drops a bad one (Next keeps hidden pages)", async () => {
    const a = actions();
    const { rerender } = render(
      <Activity mode="visible">
        <AboutForm {...MOM} actions={a} />
      </Activity>,
    );
    const user = userEvent.setup();
    await user.selectOptions(within(birthday()).getByRole("combobox", { name: "Birthday month" }), "11");
    await act(async () => {
      rerender(
        <Activity mode="hidden">
          <AboutForm {...MOM} actions={a} />
        </Activity>,
      );
    });
    expect(a.setDate).toHaveBeenCalledWith("p1", "birthday", "11", "14");
  });

  it("disables every field until the page can save (AC-8, ALL-110)", async () => {
    const ui = <AboutForm {...MOM} anniversary={{ month: 6, day: 5 }} actions={actions()} />;
    const container = document.body.appendChild(document.createElement("div"));
    onTestFinished(() => container.remove());
    container.innerHTML = renderToString(ui);
    const fields = [...container.querySelectorAll("input, select")];
    expect(fields.length).toBe(7);
    for (const f of fields) expect(f).toBeDisabled();
    await act(async () => {
      render(ui, { container, hydrate: true });
    });
    expect(within(container).getByRole("textbox", { name: "Name" })).toBeEnabled();
    expect(within(container).getByRole("combobox", { name: "Birthday month" })).toBeEnabled();
  });
});
