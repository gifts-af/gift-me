import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtensionLink } from "../extension-link";

const STORE = "https://chromewebstore.google.com/detail/giftsaf/abc";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DESKTOP_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

function as(ua: string) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ExtensionLink", () => {
  it("links to the store listing on desktop Chrome", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_STORE_URL", STORE);
    as(DESKTOP_CHROME);
    render(<ExtensionLink>the extension</ExtensionLink>);
    const link = await screen.findByRole("link", { name: "the extension" });
    expect(link).toHaveAttribute("href", STORE);
  });

  it.each([
    ["Android Chrome", ANDROID_CHROME],
    ["iPhone", IPHONE],
    ["desktop Safari", DESKTOP_SAFARI],
  ])("is plain text on %s", (_name, ua) => {
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_STORE_URL", STORE);
    as(ua);
    render(<ExtensionLink>the extension</ExtensionLink>);
    expect(screen.getByText("the extension")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("is plain text when the store URL isn't set", () => {
    as(DESKTOP_CHROME);
    render(<ExtensionLink>the extension</ExtensionLink>);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
