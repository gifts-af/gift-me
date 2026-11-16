import { describe, expect, it, vi } from "vitest";
import { Activity } from "react";
import { act, render, renderHook } from "@testing-library/react";
import { useAutosave } from "../use-autosave";

type Result = { ok: true } | { ok: false; error: string };

function deferred() {
  let resolve!: (r: Result) => void;
  const promise = new Promise<Result>((r) => (resolve = r));
  return { promise, resolve };
}

describe("useAutosave", () => {
  it("saves a change once and shows saved", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAutosave({ initial: "a", save }));
    act(() => result.current.setValue("b"));
    await act(async () => result.current.commit());
    await act(async () => result.current.commit());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("b");
    expect(result.current.status).toBe("saved");
  });

  it("does not save when unchanged", async () => {
    const save = vi.fn();
    const { result } = renderHook(() => useAutosave({ initial: "a", save }));
    await act(async () => result.current.onBlur());
    expect(save).not.toHaveBeenCalled();
  });

  it("commit(next) sets and saves at once, for choices and switches", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAutosave({ initial: false, save }));
    await act(async () => result.current.commit(true));
    expect(save).toHaveBeenCalledWith(true);
    expect(result.current.value).toBe(true);
  });

  it("saves an object as one call, compared with equals", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const equals = (a: { m: string; d: string }, b: { m: string; d: string }) => a.m === b.m && a.d === b.d;
    const { result } = renderHook(() => useAutosave({ initial: { m: "3", d: "14" }, save, equals }));
    act(() => result.current.setValue({ m: "11", d: "14" }));
    act(() => result.current.setValue({ m: "11", d: "30" }));
    await act(async () => result.current.commit());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ m: "11", d: "30" });
    act(() => result.current.setValue({ m: "11", d: "30" }));
    await act(async () => result.current.commit());
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("Enter saves; other keys don't", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAutosave({ initial: "a", save }));
    act(() => result.current.setValue("b"));
    const preventDefault = vi.fn();
    await act(async () => result.current.onKeyDown({ key: "x", preventDefault } as never));
    expect(save).not.toHaveBeenCalled();
    await act(async () => result.current.onKeyDown({ key: "Enter", preventDefault } as never));
    expect(save).toHaveBeenCalledWith("b");
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("keeps the value and exposes the error when a save fails, and can try again", async () => {
    const save = vi.fn().mockResolvedValueOnce({ ok: false, error: "Nope." }).mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAutosave({ initial: "a", save }));
    act(() => result.current.setValue("b"));
    await act(async () => result.current.commit());
    expect(result.current.value).toBe("b");
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Nope.");
    await act(async () => result.current.commit());
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("saved");
    expect(result.current.error).toBeNull();
  });

  it("treats a thrown save as a failure", async () => {
    const save = vi.fn().mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useAutosave({ initial: "a", save }));
    act(() => result.current.setValue("b"));
    await act(async () => result.current.commit());
    expect(result.current.error).toBe("That didn't save. Try again.");
  });

  it("runs one save at a time, then saves the latest value", async () => {
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAutosave({ initial: "a", save }));
    await act(async () => void result.current.commit("b"));
    expect(result.current.status).toBe("saving");
    await act(async () => void result.current.commit("c"));
    await act(async () => void result.current.commit("d"));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve({ ok: true }));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("d");
    expect(result.current.status).toBe("saved");
  });

  it("doesn't show saved while a newer edit is unsaved", async () => {
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAutosave({ initial: "a", save }));
    await act(async () => void result.current.commit("b"));
    act(() => result.current.setValue("bc"));
    await act(async () => first.resolve({ ok: true }));
    expect(result.current.status).toBe("idle");
  });

  it("uses the latest save function", async () => {
    const one = vi.fn().mockResolvedValue({ ok: true });
    const two = vi.fn().mockResolvedValue({ ok: true });
    const { result, rerender } = renderHook(({ save }) => useAutosave({ initial: "a", save }), {
      initialProps: { save: one },
    });
    rerender({ save: two });
    await act(async () => result.current.commit("b"));
    expect(one).not.toHaveBeenCalled();
    expect(two).toHaveBeenCalledWith("b");
  });

  it("saves a pending change when the page is hidden, and a failure there goes back to the saved value", async () => {
    const save = vi.fn().mockResolvedValueOnce({ ok: false, error: "Nope." }).mockResolvedValue({ ok: true });
    let api!: ReturnType<typeof useAutosave<string>>;
    function Probe() {
      api = useAutosave({ initial: "a", save });
      return <p>{api.value}</p>;
    }
    const ui = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <Probe />
      </Activity>
    );
    const { rerender } = render(ui("visible"));
    act(() => api.setValue("b"));
    await act(async () => rerender(ui("hidden")));
    expect(save).toHaveBeenCalledWith("b");
    await act(async () => rerender(ui("visible")));
    expect(api.value).toBe("a");
    expect(api.error).toBeNull();
    await act(async () => api.commit("b"));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("saves a pending change on unmount", () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result, unmount } = renderHook(() => useAutosave({ initial: "a", save }));
    act(() => result.current.setValue("b"));
    unmount();
    expect(save).toHaveBeenCalledWith("b");
  });
});
