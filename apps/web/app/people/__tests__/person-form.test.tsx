import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonForm } from "../person-form";
import type { PhotoStorage } from "../photo-picker";

const push = vi.fn();
const useRouterMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => useRouterMock() }));

const photo = new File(["x".repeat(100)], "me.png", { type: "image/png" });

type Result = { ok: true; id: string } | { ok: false; error: string; existingId?: string };

function setup(addResult: Result = { ok: true, id: "new1" }, extra: { initialName?: string; shareToken?: string; heldGiftNotice?: boolean; initialBirthday?: { month: number; day: number } } = {}) {
  const calls: string[] = [];
  const action = vi.fn(async (...args: [unknown, FormData]) => {
    void args;
    calls.push("add");
    return addResult;
  });
  const photoAction = vi.fn(async () => {
    calls.push("setPhoto");
    return { ok: true } as const;
  });
  const upload = vi.fn<PhotoStorage["upload"]>(async () => {
    calls.push("upload");
    return { error: null };
  });
  const storage: PhotoStorage = { upload, remove: vi.fn(async () => ({ error: null })) };
  const resize = vi.fn(async () => new Blob(["j"], { type: "image/jpeg" }));
  render(
    <PersonForm
      action={action}
      photoAction={photoAction}
      userId="u1"
      maxUploadBytes={1000}
      px={512}
      doneHref="/give"
      storage={storage}
      resize={resize}
      heldGiftNotice
      {...extra}
    />,
  );
  return { calls, action, photoAction, upload, resize };
}

const relationship = () => screen.getByLabelText("Who are they to you?");
const fill = async (name = "Mom", rel = "Mother") => {
  await userEvent.type(screen.getByLabelText("Name"), name);
  await userEvent.selectOptions(relationship(), rel);
};
const save = () => userEvent.click(screen.getByRole("button", { name: /^Add (?!a photo)/ }));
const sent = (t: ReturnType<typeof setup>) => t.action.mock.calls[0][1];

describe("PersonForm", () => {
  beforeEach(() => {
    push.mockClear();
    useRouterMock.mockReturnValue({ push });
  });

  it("submits with only a name and a relationship, then goes Home", async () => {
    const t = setup();
    await fill();
    await save();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/give"));
    const form = sent(t);
    expect(form.get("name")).toBe("Mom");
    expect(form.get("relationship")).toBe("mother");
    expect(form.get("birthdayMonth")).toBe("");
    expect(form.get("birthdayDay")).toBe("");
    expect(form.get("birthYear")).toBe("");
    expect(form.has("anniversaryMonth")).toBe(false);
    expect(t.upload).not.toHaveBeenCalled();
  });

  it("starts with the list owner's birthday, and sends it with no year (ALL-182 AC-5)", async () => {
    const t = setup(undefined, { initialBirthday: { month: 3, day: 14 } });
    expect(screen.getByText("From their list. You can change it.")).toBeVisible();
    await fill();
    await save();
    expect(sent(t).get("birthdayMonth")).toBe("3");
    expect(sent(t).get("birthdayDay")).toBe("14");
    expect(sent(t).get("birthYear")).toBe("");
  });

  it("sends none once it's cleared, and the note goes (ALL-182 AC-5)", async () => {
    const t = setup(undefined, { initialBirthday: { month: 3, day: 14 } });
    await userEvent.selectOptions(screen.getByLabelText("Birthday month"), "Month");
    expect(screen.queryByText("From their list. You can change it.")).toBeNull();
    await userEvent.clear(screen.getByLabelText("Birthday day"));
    await fill();
    await save();
    expect(sent(t).get("birthdayMonth")).toBe("");
    expect(sent(t).get("birthdayDay")).toBe("");
  });

  it("shows the anniversary only for a wife or husband", async () => {
    setup();
    expect(screen.queryByLabelText("Anniversary month")).toBeNull();
    await userEvent.selectOptions(relationship(), "Wife");
    expect(screen.getByLabelText("Anniversary month")).toBeInTheDocument();
    await userEvent.selectOptions(relationship(), "Husband");
    expect(screen.getByLabelText("Anniversary month")).toBeInTheDocument();
    await userEvent.selectOptions(relationship(), "Friend");
    expect(screen.queryByLabelText("Anniversary month")).toBeNull();
  });

  it("does not send a stale anniversary after switching away from wife", async () => {
    const t = setup();
    await fill("Sam", "Wife");
    await userEvent.selectOptions(screen.getByLabelText("Anniversary month"), "June");
    await userEvent.selectOptions(relationship(), "Friend");
    await save();
    await waitFor(() => expect(t.action).toHaveBeenCalled());
    expect(sent(t).has("anniversaryMonth")).toBe(false);
    expect(sent(t).has("anniversaryDay")).toBe(false);
  });

  it("names the birthday and anniversary groups for screen readers", async () => {
    setup();
    expect(screen.getByRole("group", { name: "Birthday" })).toContainElement(screen.getByLabelText("Birthday month"));
    await userEvent.selectOptions(relationship(), "Wife");
    expect(screen.getByRole("group", { name: "Anniversary" })).toContainElement(
      screen.getByLabelText("Anniversary month"),
    );
  });

  it("has no Skip button", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  });

  it("finds the birthday fields by accessible name, with no visible labels", () => {
    setup();
    expect(screen.getByLabelText("Birthday month")).toBeInTheDocument();
    expect(screen.getByLabelText("Birthday day")).toBeInTheDocument();
    expect(screen.getByLabelText("Birth year (optional)")).toHaveAttribute("name", "birthYear");
    expect(screen.getByText("Optional")).toBeInTheDocument();
    expect(screen.getByText("The year is just for age-right ideas.")).toBeInTheDocument();
  });

  it("labels the submit button with the typed name", async () => {
    setup();
    expect(screen.getByRole("button", { name: "Add someone" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Name"), "  Mom ");
    expect(screen.getByRole("button", { name: "Add Mom" })).toBeInTheDocument();
  });

  it("shows initials on the photo button, then a preview and Change once a photo is chosen", async () => {
    const url = vi.fn(() => "blob:preview");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: url, revokeObjectURL: revoke }));
    setup();
    await userEvent.type(screen.getByLabelText("Name"), "Mom");
    const button = screen.getByRole("button", { name: "Add a photo" });
    expect(button).toHaveTextContent("M");
    expect(button).toHaveTextContent("Add photo");
    await userEvent.upload(screen.getByLabelText("Choose a photo"), photo);
    const changed = await screen.findByRole("button", { name: "Change photo" });
    expect(changed).toHaveTextContent("Change");
    expect(changed.querySelector("img")).toHaveAttribute("src", "blob:preview");
    await userEvent.upload(screen.getByLabelText("Choose a photo"), new File(["y"], "b.png", { type: "image/png" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:preview"));
    vi.unstubAllGlobals();
  });

  // ALL-109: one Dates card, "Optional" said once, no loose file name.
  it("groups the dates in one card that says Optional once", () => {
    setup();
    const dates = screen.getByRole("region", { name: "Dates" });
    expect(screen.getByRole("heading", { level: 2, name: "Dates" })).toBeInTheDocument();
    expect(dates).toContainElement(screen.getByRole("group", { name: "Birthday" }));
    expect(screen.getAllByText("Optional")).toHaveLength(1);
  });

  it("doesn't show the picked photo's file name", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:p", revokeObjectURL: () => {} }));
    setup();
    await userEvent.upload(screen.getByLabelText("Choose a photo"), photo);
    await screen.findByRole("button", { name: "Change photo" });
    expect(screen.queryByText("me.png")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("sends the birthday it was given", async () => {
    const t = setup();
    await fill();
    await userEvent.selectOptions(screen.getByLabelText("Birthday month"), "March");
    await userEvent.type(screen.getByLabelText("Birthday day"), "14");
    await save();
    await waitFor(() => expect(t.action).toHaveBeenCalled());
    expect(sent(t).get("birthdayMonth")).toBe("3");
    expect(sent(t).get("birthdayDay")).toBe("14");
  });

  it("uploads the photo only after the person is saved, then saves it", async () => {
    const t = setup();
    await fill();
    await userEvent.upload(screen.getByLabelText("Choose a photo"), photo);
    expect(t.upload).not.toHaveBeenCalled();
    await save();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/give"));
    expect(t.calls).toEqual(["add", "upload", "setPhoto"]);
    expect(t.upload.mock.calls[0][0]).toMatch(/^u1\/new1\/[^/]+\.jpg$/);
    const photoForm = (t.photoAction.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(photoForm.get("id")).toBe("new1");
  });

  it("does not upload when the save fails, and stays on the form", async () => {
    const t = setup({ ok: false, error: "Add a name." });
    await fill();
    await userEvent.upload(screen.getByLabelText("Choose a photo"), photo);
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent("Add a name.");
    expect(t.upload).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("goes to the new person's page with ?photo=failed when the photo failed", async () => {
    const t = setup();
    t.upload.mockResolvedValue({ error: { message: "x" } });
    await fill();
    await userEvent.upload(screen.getByLabelText("Choose a photo"), photo);
    await save();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/people/new1?photo=failed"));
    expect(t.photoAction).not.toHaveBeenCalled();
  });

  it("refuses a too-big photo as soon as it is chosen", async () => {
    const t = setup();
    await userEvent.upload(
      screen.getByLabelText("Choose a photo"),
      new File(["x".repeat(2000)], "big.png", { type: "image/png" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("That photo is too big.");
    expect(t.resize).not.toHaveBeenCalled();
  });

  it("keeps the submit button disabled after a successful save, so a second tap adds no duplicate", async () => {
    const t = setup();
    await fill();
    await save();
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Saving…" }));
    expect(t.action).toHaveBeenCalledTimes(1);
  });

  it("lets the user try again after a failed save", async () => {
    setup({ ok: false, error: "Add a name." });
    await fill();
    await save();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Mom" })).toBeEnabled();
  });

  it("disables the submit button while a picked photo is still being checked", async () => {
    const t = setup();
    let finish!: (b: Blob) => void;
    t.resize.mockImplementationOnce(() => new Promise<Blob>((resolve) => (finish = resolve)));
    await fill();
    await userEvent.upload(screen.getByLabelText("Choose a photo"), photo);
    const waiting = await screen.findByRole("button", { name: "Preparing photo…" });
    expect(waiting).toBeDisabled();
    finish(new Blob(["j"], { type: "image/jpeg" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add Mom" })).toBeEnabled());
  });

  // From a shared list's "Add Sam to your people" (ALL-123 AC-7–9).
  describe("from a list link", () => {
    const TOKEN = "3f2b8c1e-9d4a-4e6b-8a1f-0c5d7e9b2a46";
    const NOTICE = "If a gift for them is waiting on an address, it will ship to this list's owner.";

    it("starts with the owner's name, says where held gifts ship, and sends the token", async () => {
      const t = setup(undefined, { initialName: "Sam", shareToken: TOKEN, heldGiftNotice: true });
      expect(screen.getByLabelText("Name")).toHaveValue("Sam");
      expect(screen.getByText(NOTICE)).toBeInTheDocument();
      await userEvent.selectOptions(relationship(), "Friend");
      await save();
      await waitFor(() => expect(push).toHaveBeenCalledWith("/people/new1"));
      expect(sent(t).get("list")).toBe(TOKEN);
    });

    it("without access, says nothing of held gifts and still sends the token", async () => {
      const t = setup(undefined, { initialName: "Sam", shareToken: TOKEN, heldGiftNotice: false });
      expect(screen.queryByText(NOTICE)).toBeNull();
      await userEvent.selectOptions(relationship(), "Friend");
      await save();
      await waitFor(() => expect(push).toHaveBeenCalledWith("/people/new1"));
      expect(sent(t).get("list")).toBe(TOKEN);
    });

    it("has no notice and no token without a link", async () => {
      const t = setup();
      expect(screen.queryByText(NOTICE)).toBeNull();
      await fill();
      await save();
      await waitFor(() => expect(push).toHaveBeenCalledWith("/give"));
      expect(sent(t).has("list")).toBe(false);
    });

    it("goes to the person already added from this list", async () => {
      const t = setup(
        { ok: false, error: "Sam is already in your people.", existingId: "p0" },
        { initialName: "Sam", shareToken: TOKEN },
      );
      await userEvent.selectOptions(relationship(), "Friend");
      await save();
      expect(await screen.findByRole("alert")).toHaveTextContent("Sam is already in your people.");
      await waitFor(() => expect(push).toHaveBeenCalledWith("/people/p0"));
      expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
      expect(t.action).toHaveBeenCalledTimes(1);
    });
  });
});
