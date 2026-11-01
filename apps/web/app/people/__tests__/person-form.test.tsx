import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonForm } from "../person-form";
import type { PhotoStorage } from "../photo-picker";

const push = vi.fn();
const useRouterMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => useRouterMock() }));

const photo = new File(["x".repeat(100)], "me.png", { type: "image/png" });

function setup(addResult: { ok: true; id: string } | { ok: false; error: string } = { ok: true, id: "new1" }) {
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
      doneHref="/"
      storage={storage}
      resize={resize}
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
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    const form = sent(t);
    expect(form.get("name")).toBe("Mom");
    expect(form.get("relationship")).toBe("mother");
    expect(form.get("birthdayMonth")).toBe("");
    expect(form.get("birthdayDay")).toBe("");
    expect(form.get("birthYear")).toBe("");
    expect(form.has("anniversaryMonth")).toBe(false);
    expect(t.upload).not.toHaveBeenCalled();
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
    expect(screen.getByText(/The year is just for age-right ideas/)).toBeInTheDocument();
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
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
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
});

describe("PersonForm in edit mode", () => {
  const refresh = vi.fn();
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
  });

  function setupEdit(result: { ok: true } | { ok: false; error: string } = { ok: true }) {
    const action = vi.fn(async (...args: [unknown, FormData]) => {
      void args;
      return result;
    });
    render(
      <PersonForm
        mode="edit"
        action={action}
        initial={{ id: "p1", name: "Dad", relationship: "father", birthdayMonth: "4", birthdayDay: "10" }}
      />,
    );
    return action;
  }

  it("has no photo field, sends the id, then refreshes and says Saved without navigating", async () => {
    useRouterMock.mockReturnValue({ push, refresh });
    const action = setupEdit();
    expect(screen.queryByLabelText("Choose a photo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /photo/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
    expect(action.mock.calls[0][1].get("id")).toBe("p1");
    expect(action.mock.calls[0][1].get("name")).toBe("Dad");
    expect(refresh).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("always shows the anniversary fields, even for a friend", () => {
    useRouterMock.mockReturnValue({ push, refresh });
    const action = vi.fn(async (...a: [unknown, FormData]) => (void a, { ok: true } as const));
    render(
      <PersonForm
        mode="edit"
        action={action}
        initial={{ id: "p2", name: "Sam", relationship: "friend", anniversaryMonth: "6", anniversaryDay: "5" }}
      />,
    );
    expect(screen.getByLabelText("Anniversary month")).toBeInTheDocument();
    expect(screen.getByText("Anniversary")).toBeInTheDocument();
    expect(screen.queryByLabelText("Anniversary year")).toBeNull();
  });

  it("shows the error and no Saved note when the save fails", async () => {
    useRouterMock.mockReturnValue({ push, refresh });
    setupEdit({ ok: false, error: "Add a name." });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add a name.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
