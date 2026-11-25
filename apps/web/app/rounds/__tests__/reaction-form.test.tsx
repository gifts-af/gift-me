import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SaveReactionResult } from "../actions";
import { ReactionForm, type ReactionFormProps } from "../[id]/reaction/reaction-form";

// The save is faked here; reactions-db.test.ts runs the real one on the local database.

type Gift = ReactionFormProps["gifts"][number];
type Save = ReactionFormProps["saveAction"];
const gift = (o: Partial<Gift> = {}): Gift => ({ orderId: "o1", title: "Cozy blanket", imageUrl: null, rating: null, note: null, ...o });
const TWO = [gift(), gift({ orderId: "o2", title: "Tea sampler" })];
const SAVED = "Saved. Thanks for telling us.";

const scrollIntoView = vi.fn();
beforeEach(() => {
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
});

const ok: SaveReactionResult = { ok: true, complete: false };
function props(o: Partial<Omit<ReactionFormProps, "saveAction">> = {}, save: Save = async () => ok) {
  const saveAction = vi.fn<Save>(save);
  return { gifts: [gift()], noteMaxChars: 500, opened: null, personName: "Nora", personId: "p1", ...o, saveAction };
}
function setup(...a: Parameters<typeof props>) {
  const p = props(...a);
  render(<ReactionForm {...p} />);
  return p;
}
const card = (title: string) => within(screen.getByRole("listitem", { name: title }));
const choose = (title: string, label: string) => userEvent.click(card(title).getByRole("radio", { name: label }));
const save = (title: string) => card(title).getByRole("button", { name: `Save: ${title}` });
const TEAL = "bg-primary";

describe("ReactionForm", () => {
  it("has nothing to choose, type or press until the page can keep it", async () => {
    const ui = <ReactionForm {...props()} />;
    const container = document.body.appendChild(document.createElement("div"));
    onTestFinished(() => container.remove());
    container.innerHTML = renderToString(ui);
    const controls = () => [...container.querySelectorAll("input, textarea")];
    expect(controls()).toHaveLength(5);
    for (const c of controls()) expect(c).toBeDisabled();
    expect(container.querySelector("button")).toBeDisabled();
    await act(async () => void render(ui, { container, hydrate: true }));
    for (const c of controls()) expect(c).toBeEnabled();
  });

  it("offers the four answers and a note no longer than the limit, and saves nothing on its own", async () => {
    const { saveAction } = setup({ noteMaxChars: 12 });
    expect(screen.getAllByRole("radio").map((r) => r.closest("label")?.textContent)).toEqual(["Loved it", "Liked it", "Meh", "Returned it"]);
    expect(screen.getByRole("textbox", { name: /Note/ })).toHaveAttribute("maxlength", "12");
    expect(save("Cozy blanket")).toHaveAttribute("aria-disabled", "true");
    expect(save("Cozy blanket")).not.toHaveClass(TEAL);
    await choose("Cozy blanket", "Meh");
    expect(save("Cozy blanket")).not.toHaveAttribute("aria-disabled", "true");
    expect(save("Cozy blanket")).toHaveClass(TEAL);
    expect(saveAction).not.toHaveBeenCalled();
  });

  it("saves one gift and says so, leaving what's typed on the other", async () => {
    const { saveAction } = setup({ gifts: TWO });
    await userEvent.type(card("Tea sampler").getByRole("textbox"), "too bitter");
    await choose("Tea sampler", "Meh");
    await choose("Cozy blanket", "Loved it");
    await userEvent.type(card("Cozy blanket").getByRole("textbox"), "So soft");
    await userEvent.click(save("Cozy blanket"));
    expect(await card("Cozy blanket").findByText(SAVED)).toBeInTheDocument();
    expect(saveAction).toHaveBeenCalledOnce();
    expect(saveAction.mock.calls[0][0]).toBe("o1");
    expect(Object.fromEntries(saveAction.mock.calls[0][1])).toEqual({ rating: "loved", note: "So soft" });
    expect(card("Tea sampler").getByRole("textbox")).toHaveValue("too bitter");
    expect(card("Tea sampler").getByRole("radio", { name: "Meh" })).toBeChecked();
    expect(card("Tea sampler").queryByText(SAVED)).toBeNull();
    expect(screen.queryByRole("link", { name: "Back to Nora" })).toBeNull();

    await userEvent.click(save("Tea sampler"));
    expect(await screen.findByRole("link", { name: "Back to Nora" })).toHaveAttribute("href", "/people/p1");
  });

  it("a saved answer can be changed and saved again", async () => {
    const { saveAction } = setup({ gifts: [gift({ rating: "loved", note: "nice" })] });
    expect(screen.getByRole("radio", { name: "Loved it" })).toBeChecked();
    expect(screen.getByRole("textbox")).toHaveValue("nice");
    expect(save("Cozy blanket")).toHaveAttribute("aria-disabled", "true");
    expect(save("Cozy blanket")).not.toHaveClass(TEAL);
    await choose("Cozy blanket", "Returned it");
    expect(screen.getByText("Not saved yet.")).toBeInTheDocument();
    await userEvent.click(save("Cozy blanket"));
    expect(await screen.findByText(SAVED)).toBeInTheDocument();
    expect(saveAction.mock.calls[0][1].get("rating")).toBe("returned");
    await userEvent.type(screen.getByRole("textbox"), "!");
    expect(screen.queryByText(SAVED)).toBeNull();
    expect(save("Cozy blanket")).not.toHaveAttribute("aria-disabled", "true");
    expect(save("Cozy blanket")).toHaveClass(TEAL);
  });

  it("a double tap saves once", async () => {
    let finish!: (r: SaveReactionResult) => void;
    const { saveAction } = setup({}, () => new Promise((r) => (finish = r)));
    await choose("Cozy blanket", "Liked it");
    const button = save("Cozy blanket");
    act(() => {
      button.click();
      button.click();
    });
    expect(saveAction).toHaveBeenCalledOnce();
    await act(async () => finish(ok));
    expect(screen.getByText(SAVED)).toBeInTheDocument();
  });

  it("what's typed while a save is on its way isn't called saved", async () => {
    let finish!: (r: SaveReactionResult) => void;
    setup({}, () => new Promise((r) => (finish = r)));
    await choose("Cozy blanket", "Liked it");
    await userEvent.click(save("Cozy blanket"));
    await userEvent.type(screen.getByRole("textbox"), "more");
    await act(async () => finish(ok));
    expect(screen.getByRole("textbox")).toHaveValue("more");
    expect(screen.queryByText(SAVED)).toBeNull();
    expect(save("Cozy blanket")).not.toHaveAttribute("aria-disabled", "true");
    expect(save("Cozy blanket")).toHaveClass(TEAL);
  });

  const refused: Save = async () => ({ ok: false, reason: "sensitive", error: "Try wording it another way." });
  const tooLong: Save = async () => ({ ok: false, reason: "note_too_long", error: "That note is too long." });
  const off: Save = async () => ({ ok: false, reason: "off", error: "Not available right now." });
  const offline: Save = () => Promise.reject(new Error("offline"));
  it.each([
    ["a sensitive note", refused, "Try wording it another way.", true],
    ["a long note", tooLong, "That note is too long.", true],
    ["another refusal", off, "Not available right now.", false],
    ["a lost connection", offline, "That didn't save. Try again.", false],
  ])("%s keeps the answer and the note, and says why", async (_, action, message, noteAtFault) => {
    setup({}, action);
    await choose("Cozy blanket", "Meh");
    await userEvent.type(screen.getByRole("textbox"), "itchy");
    await userEvent.click(save("Cozy blanket"));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("textbox")).toHaveValue("itchy");
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe(noteAtFault ? "true" : null);
    expect(screen.getByRole("radio", { name: "Meh" })).toBeChecked();
    await waitFor(() => expect(save("Cozy blanket")).not.toHaveAttribute("aria-disabled", "true"));
  });

  it("a note without an answer says to choose one, and saves nothing", async () => {
    const { saveAction } = setup();
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    await userEvent.type(screen.getByRole("textbox"), "nice");
    expect(status).toHaveTextContent("Choose an answer to save.");
    expect(save("Cozy blanket")).not.toHaveClass(TEAL);
    await userEvent.click(save("Cozy blanket"));
    expect(saveAction).not.toHaveBeenCalled();
  });

  it("keeps focus on Save and announces it", async () => {
    setup({ opened: { orderId: "o1", rating: "loved" } });
    await userEvent.click(save("Cozy blanket"));
    expect(await screen.findByText(SAVED)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(SAVED);
    expect(save("Cozy blanket")).toHaveFocus();
    expect(save("Cozy blanket")).not.toHaveClass(TEAL);
  });

  it("names each group of answers, and leaves the photo out for screen readers", () => {
    setup();
    expect(screen.getByRole("group", { name: "How did Cozy blanket go?" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("opened from an email's answer: chosen and in view, but not saved", () => {
    const { saveAction } = setup({ gifts: TWO, opened: { orderId: "o2", rating: "loved" } });
    expect(card("Tea sampler").getByRole("radio", { name: "Loved it" })).toBeChecked();
    expect(card("Tea sampler").getByText("Not saved yet.")).toBeInTheDocument();
    for (const r of card("Cozy blanket").getAllByRole("radio")) expect(r).not.toBeChecked();
    expect(scrollIntoView.mock.contexts).toEqual([screen.getByRole("listitem", { name: "Tea sampler" })]);
    expect(saveAction).not.toHaveBeenCalled();
  });

  it("opened on a gift without an answer in the link: in view, its saved answer kept", () => {
    setup({ gifts: [gift({ rating: "meh" })], opened: { orderId: "o1", rating: null } });
    expect(screen.getByRole("radio", { name: "Meh" })).toBeChecked();
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  it("goes back to the people when this person was removed", () => {
    setup({ gifts: [gift({ rating: "meh" })], personName: null });
    expect(screen.getByRole("link", { name: "Go to your people" })).toHaveAttribute("href", "/give");
  });
});
