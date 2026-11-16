import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TimeZoneRow } from "../time-zone-row";

const zones = ["America/Los_Angeles", "America/New_York", "Europe/London"];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function pick(zone: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: zone } });
}
async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("TimeZoneRow", () => {
  it("names the select by the label and the value", () => {
    render(<TimeZoneRow zones={zones} saved="America/New_York" fallback={null} action={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Time zone America/New York" })).toHaveValue("America/New_York");
  });

  it("saves a pick after the delay and shows Saved", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(<TimeZoneRow zones={zones} saved="America/New_York" fallback={null} action={action} />);
    await pick("Europe/London");
    expect(action).not.toHaveBeenCalled();
    await wait(400);
    expect(action).toHaveBeenCalledWith("Europe/London");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.getByRole("combobox", { name: "Time zone Europe/London" })).toBeInTheDocument();
  });

  it("sends only the last of several quick picks", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(<TimeZoneRow zones={zones} saved="America/New_York" fallback={null} action={action} />);
    await pick("Europe/London");
    await wait(100);
    await pick("America/Los_Angeles");
    await wait(100);
    await pick("Europe/London");
    await wait(400);
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith("Europe/London");
  });

  it("shows the error and keeps the pick when saving fails", async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, error: "Pick a real zone." });
    render(<TimeZoneRow zones={zones} saved="America/New_York" fallback={null} action={action} />);
    await pick("Europe/London");
    await wait(400);
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a real zone.");
    expect(screen.getByRole("combobox")).toHaveValue("Europe/London");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("ignores a late result from an older pick", async () => {
    let first!: (value: { ok: false; error: string }) => void;
    const action = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (first = resolve)))
      .mockResolvedValueOnce({ ok: true });
    render(<TimeZoneRow zones={zones} saved="America/New_York" fallback={null} action={action} />);
    await pick("Europe/London");
    await wait(400);
    await pick("America/Los_Angeles");
    await wait(400);
    await act(async () => first({ ok: false, error: "old failure" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("offers the fallback when nothing is saved, and saving it fires a change", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(<TimeZoneRow zones={zones} saved={null} fallback="America/Los_Angeles" action={action} />);
    expect(screen.getByText("Not set (using America/Los Angeles)")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("");
    await pick("America/Los_Angeles");
    await wait(400);
    expect(action).toHaveBeenCalledWith("America/Los_Angeles");
  });

  it("says Not set with no saved zone and no fallback", () => {
    render(<TimeZoneRow zones={zones} saved={null} fallback={null} action={vi.fn()} />);
    expect(screen.getByText("Not set")).toBeInTheDocument();
  });

  it("falls back to a thrown action as an error", async () => {
    const action = vi.fn().mockRejectedValue(new Error("boom"));
    render(<TimeZoneRow zones={zones} saved="America/New_York" fallback={null} action={action} />);
    await pick("Europe/London");
    await wait(400);
    expect(screen.getByRole("alert")).toHaveTextContent("That didn't save. Try again.");
  });
});
