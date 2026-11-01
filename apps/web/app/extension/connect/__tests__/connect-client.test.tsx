import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectClient } from "../connect-client";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ConnectClient", () => {
  it("shows install steps when chrome.runtime is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_ID", "abc");
    const action = vi.fn();
    render(<ConnectClient action={action} />);
    expect(await screen.findByText(/apps\/extension\/README\.md/)).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
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
