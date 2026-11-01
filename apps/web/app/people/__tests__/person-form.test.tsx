import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonForm } from "../person-form";
import type { PhotoStorage } from "../photo-picker";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

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
const save = () => userEvent.click(screen.getByRole("button", { name: "Save" }));
const sent = (t: ReturnType<typeof setup>) => t.action.mock.calls[0][1];

describe("PersonForm", () => {
  beforeEach(() => push.mockClear());

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

  it("Skip clears the birthday", async () => {
    setup();
    await userEvent.selectOptions(screen.getByLabelText("Birthday month"), "March");
    await userEvent.type(screen.getByLabelText("Birthday day"), "14");
    await userEvent.type(screen.getByLabelText("Birth year (optional)"), "1960");
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByLabelText("Birthday month")).toHaveValue("");
    expect(screen.getByLabelText("Birthday day")).toHaveValue(null);
    expect(screen.getByLabelText("Birth year (optional)")).toHaveValue(null);
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

  it("still goes Home when the person saved but the photo failed", async () => {
    const t = setup();
    t.upload.mockResolvedValue({ error: { message: "x" } });
    await fill();
    await userEvent.upload(screen.getByLabelText("Choose a photo"), photo);
    await save();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
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
});
