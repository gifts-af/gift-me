import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhotoPicker, type PhotoStorage } from "../photo-picker";

const photo = new File(["x".repeat(100)], "me.png", { type: "image/png" });

function setup(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const action = vi.fn(async () => {
    calls.push("action");
    return { ok: true } as const;
  });
  const storage = {
    upload: vi.fn<PhotoStorage["upload"]>(async () => {
      calls.push("upload");
      return { error: null };
    }),
    remove: vi.fn<PhotoStorage["remove"]>(async () => {
      calls.push("remove");
      return { error: null };
    }),
  };
  const resize = vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" }));
  const onSaved = vi.fn();
  render(
    <PhotoPicker
      personId="p1"
      userId="u1"
      currentPath="u1/p1/old.jpg"
      maxUploadBytes={1000}
      px={512}
      action={action}
      storage={storage}
      resize={resize}
      onSaved={onSaved}
      {...overrides}
    />,
  );
  return { calls, action, storage, resize, onSaved };
}

const choose = (file: File) => userEvent.upload(screen.getByLabelText("Choose a photo"), file);

describe("PhotoPicker", () => {
  it("refuses a file over the size limit and changes nothing", async () => {
    const t = setup({ maxUploadBytes: 50 });
    await choose(photo);
    expect(await screen.findByRole("alert")).toHaveTextContent("That photo is too big.");
    expect(t.storage.upload).not.toHaveBeenCalled();
    expect(t.action).not.toHaveBeenCalled();
    expect(t.storage.remove).not.toHaveBeenCalled();
  });

  it("keeps the old photo when the upload fails", async () => {
    const t = setup();
    t.storage.upload.mockResolvedValue({ error: { message: "boom" } });
    await choose(photo);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(t.action).not.toHaveBeenCalled();
    expect(t.storage.remove).not.toHaveBeenCalled();
  });

  it("says so, and changes nothing, when the file isn't a usable image", async () => {
    const t = setup();
    t.resize.mockRejectedValue(new Error("decode"));
    await choose(photo);
    expect(await screen.findByRole("alert")).toHaveTextContent("That file isn't a photo we can use.");
    expect(t.storage.upload).not.toHaveBeenCalled();
    expect(t.action).not.toHaveBeenCalled();
  });

  it("uploads under the user and person, saves, then removes the old object", async () => {
    const t = setup();
    await choose(photo);
    await vi.waitFor(() => expect(t.onSaved).toHaveBeenCalled());
    const [path] = t.storage.upload.mock.calls[0] as unknown as [string];
    expect(path).toMatch(/^u1\/p1\/[^/]+\.jpg$/);
    const form = (t.action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(form.get("id")).toBe("p1");
    expect(form.get("path")).toBe(path);
    expect(t.calls).toEqual(["upload", "action", "remove"]);
    expect(t.storage.remove).toHaveBeenCalledWith("u1/p1/old.jpg");
    expect(t.onSaved).toHaveBeenCalledWith(path);
  });

  it("keeps the old object when the action fails, and removes the new upload", async () => {
    const t = setup();
    t.action.mockResolvedValue({ ok: false, error: "Nope." } as never);
    await choose(photo);
    expect(await screen.findByRole("alert")).toHaveTextContent("Nope.");
    const [uploaded] = t.storage.upload.mock.calls[0];
    expect(t.storage.remove).toHaveBeenCalledTimes(1);
    expect(t.storage.remove).toHaveBeenCalledWith(uploaded);
    expect(t.storage.remove).not.toHaveBeenCalledWith("u1/p1/old.jpg");
    expect(t.onSaved).not.toHaveBeenCalled();
  });

  it("cleans up the new upload and keeps the old photo when the action throws", async () => {
    const t = setup();
    t.action.mockRejectedValue(new Error("network"));
    await choose(photo);
    expect(await screen.findByRole("alert")).toHaveTextContent("The photo didn't save. Try again.");
    const [uploaded] = t.storage.upload.mock.calls[0];
    expect(t.storage.remove).toHaveBeenCalledTimes(1);
    expect(t.storage.remove).toHaveBeenCalledWith(uploaded);
    expect(t.onSaved).not.toHaveBeenCalled();
  });

  it("still reports success when removing the old object throws", async () => {
    const t = setup();
    t.storage.remove.mockRejectedValue(new Error("gone"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await choose(photo);
    await vi.waitFor(() => expect(t.onSaved).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    log.mockRestore();
  });
});
