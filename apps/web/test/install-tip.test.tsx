import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallTip } from "@/components/app-shell/install-tip";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const DISMISSED_KEY = "giftsaf:install-tip-dismissed-at";

function setDevice(ua: string, { standalone = false, touchPoints = 5 } = {}) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
  Object.defineProperty(window.navigator, "maxTouchPoints", { value: touchPoints, configurable: true });
  window.matchMedia = vi.fn((query: string) => ({
    matches: standalone && query === "(display-mode: standalone)",
    media: query,
  })) as unknown as typeof window.matchMedia;
}

const heading = () => screen.queryByRole("heading", { name: "Add GiftsAF to your Home Screen" });

describe("InstallTip (ALL-57)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("shows iPhone steps with the Share button in a phone browser", async () => {
    setDevice(IPHONE);
    render(<InstallTip snoozeDays={14} />);
    expect(await screen.findByRole("heading", { name: "Add GiftsAF to your Home Screen" })).toBeTruthy();
    expect(screen.getByText(/Add to Home Screen/, { selector: "p *, p" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("never shows when opened from the Home Screen", () => {
    setDevice(IPHONE, { standalone: true });
    render(<InstallTip snoozeDays={14} />);
    expect(heading()).toBeNull();
  });

  it("never shows on a computer", () => {
    setDevice(WINDOWS, { touchPoints: 0 });
    render(<InstallTip snoozeDays={14} />);
    expect(heading()).toBeNull();
  });

  it("on Android without the browser's install offer, shows the menu steps", async () => {
    setDevice(ANDROID);
    render(<InstallTip snoozeDays={14} />);
    await screen.findByRole("heading", { name: "Add GiftsAF to your Home Screen" });
    expect(screen.getByText(/Add to Home screen/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("on Android with the install offer, Install opens the browser's dialog and the tip goes once installed", async () => {
    setDevice(ANDROID);
    render(<InstallTip snoozeDays={14} />);
    await screen.findByRole("heading", { name: "Add GiftsAF to your Home Screen" });

    const prompt = vi.fn().mockResolvedValue(undefined);
    const offer = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    act(() => void window.dispatchEvent(offer));
    expect(offer.defaultPrevented).toBe(true);

    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    expect(prompt).toHaveBeenCalled();

    act(() => void window.dispatchEvent(new Event("appinstalled")));
    expect(heading()).toBeNull();
  });

  it("Not now hides it and remembers, until the snooze ends", async () => {
    setDevice(IPHONE);
    const { unmount } = render(<InstallTip snoozeDays={14} />);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(heading()).toBeNull();
    expect(localStorage.getItem(DISMISSED_KEY)).not.toBeNull();
    unmount();

    render(<InstallTip snoozeDays={14} />);
    expect(heading()).toBeNull();
  });

  it("shows again once the snooze has passed", async () => {
    setDevice(IPHONE);
    localStorage.setItem(DISMISSED_KEY, new Date(Date.now() - 15 * 86_400_000).toISOString());
    render(<InstallTip snoozeDays={14} />);
    expect(await screen.findByRole("heading", { name: "Add GiftsAF to your Home Screen" })).toBeTruthy();
  });

  it("still works when the browser blocks storage", async () => {
    setDevice(IPHONE);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<InstallTip snoozeDays={14} />);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(heading()).toBeNull();
  });
});
