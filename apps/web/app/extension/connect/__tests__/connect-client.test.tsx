import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectClient } from "../connect-client";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConnectClient", () => {
  it("shows install steps when chrome.runtime is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_ID", "abc");
    const action = vi.fn();
    render(<ConnectClient action={action} />);
    expect(await screen.findByText(/apps\/extension\/README\.md/)).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });

  it("offers Add to Chrome when the extension isn't installed and the listing is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_ID", "abc");
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_STORE_URL", "https://chromewebstore.google.com/detail/giftsaf/abc");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    );
    render(<ConnectClient action={vi.fn()} />);
    const link = await screen.findByRole("link", { name: /add to chrome/i });
    expect(link).toHaveAttribute("href", "https://chromewebstore.google.com/detail/giftsaf/abc");
  });

  it("shows an error with a retry button when the action rejects", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_ID", "abc");
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn() } });
    const action = vi.fn(async () => {
      throw new Error("Failed to find Server Action");
    });
    render(<ConnectClient action={action} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Failed to find/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("reloads the page from the not-installed state", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_ID", "abc");
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<ConnectClient action={vi.fn()} />);
    (await screen.findByRole("button", { name: /reload/i })).click();
    expect(reload).toHaveBeenCalled();
  });

  it("shows connected when the extension replies ok, calling the action once", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_ID", "abc");
    const sendMessage = vi.fn((_id, _msg, cb) => cb({ ok: true }));
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    const action = vi.fn(async () => ({ tokenHash: "h" }));
    render(<ConnectClient action={action} />);
    expect(await screen.findByText(/Extension connected/)).toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith("abc", { type: "connect", tokenHash: "h" }, expect.any(Function));
  });
});
