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

  it("saves a pending change when the tab is hidden, as when switching apps on a phone", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAutosave({ initial: "a", save }));
    act(() => result.current.setValue("b"));
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    state.mockRestore();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("b");
    expect(result.current.status).toBe("saved");
  });

  it("sends nothing when the tab is shown again", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAutosave({ initial: "a", save }));
    act(() => result.current.setValue("b"));
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    expect(save).not.toHaveBeenCalled();
  });

  it("saves a pending change on unmount", () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result, unmount } = renderHook(() => useAutosave({ initial: "a", save }));
    act(() => result.current.setValue("b"));
    unmount();
    expect(save).toHaveBeenCalledWith("b");
  });

  // Review of PR 1 (blocker): after an explicit reset (a Remove, a Delete), a
  // failed value must never be sent again, or it could bring the thing back.
  describe("reset", () => {
    it("makes a value the saved one, so a failed value isn't sent on unmount", async () => {
      const save = vi.fn().mockResolvedValue({ ok: false, error: "Nope." });
      const { result, unmount } = renderHook(() => useAutosave({ initial: "a", save }));
      await act(async () => result.current.commit("b"));
      expect(result.current.status).toBe("error");
      act(() => result.current.reset(""));
      expect(result.current.value).toBe("");
      expect(result.current.status).toBe("idle");
      expect(result.current.error).toBeNull();
      unmount();
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("ignores a save still in flight when reset, and drops a queued one", async () => {
      const first = deferred();
      const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true });
      const { result, unmount } = renderHook(() => useAutosave({ initial: "a", save }));
      await act(async () => void result.current.commit("b"));
      await act(async () => void result.current.commit("c"));
      act(() => result.current.reset("z"));
      await act(async () => first.resolve({ ok: true }));
      expect(save).toHaveBeenCalledTimes(1);
      expect(result.current.value).toBe("z");
      expect(result.current.status).toBe("idle");
      unmount();
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("saves changes made after it as usual", async () => {
      const save = vi.fn().mockResolvedValue({ ok: true });
      const { result } = renderHook(() => useAutosave({ initial: "a", save }));
      act(() => result.current.reset("x"));
      await act(async () => result.current.commit("x"));
      expect(save).not.toHaveBeenCalled();
      await act(async () => result.current.commit("y"));
      expect(save).toHaveBeenCalledWith("y");
    });
  });

  // Review of PR 1: Done waits for the save and closes only if it worked.
  describe("commit's result", () => {
    it("is null when there's nothing to save", async () => {
      const save = vi.fn();
      const { result } = renderHook(() => useAutosave({ initial: "a", save }));
      let got: unknown = "unset";
      await act(async () => {
        got = await result.current.commit();
      });
      expect(got).toBeNull();
    });

    it("is the save's result", async () => {
      const save = vi.fn().mockResolvedValue({ ok: false, error: "Nope." });
      const { result } = renderHook(() => useAutosave({ initial: "a", save }));
      let got: unknown;
      await act(async () => {
        got = await result.current.commit("b");
      });
      expect(got).toEqual({ ok: false, error: "Nope." });
    });

    it("during a save, waits for it and the queued one, and gives the last result", async () => {
      const first = deferred();
      const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ ok: false, error: "Second." });
      const { result } = renderHook(() => useAutosave({ initial: "a", save }));
      await act(async () => void result.current.commit("b"));
      let got: unknown;
      let waiting!: Promise<unknown>;
      act(() => {
        waiting = result.current.commit("c").then((r) => (got = r));
      });
      await act(async () => first.resolve({ ok: true }));
      await act(async () => waiting);
      expect(save).toHaveBeenCalledTimes(2);
      expect(got).toEqual({ ok: false, error: "Second." });
    });

    it("during a save with nothing new, gives that save's result", async () => {
      const first = deferred();
      const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true });
      const { result } = renderHook(() => useAutosave({ initial: "a", save }));
      await act(async () => void result.current.commit("b"));
      let waiting!: Promise<unknown>;
      act(() => {
        waiting = result.current.commit();
      });
      await act(async () => first.resolve({ ok: false, error: "Nope." }));
      expect(await waiting).toEqual({ ok: false, error: "Nope." });
      // The failed value isn't sent twice in a row.
      expect(save).toHaveBeenCalledTimes(1);
    });
  });
});
