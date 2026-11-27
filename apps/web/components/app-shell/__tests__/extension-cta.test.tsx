import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtensionCta } from "../extension-cta";

const STORE = "https://chromewebstore.google.com/detail/test";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const DESKTOP_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

const EXTENSION_ID = "bfagebaknjjgpopoieojpkogbifnijch";
type Runtime = { sendMessage: (id: string, message: unknown, reply: (r: unknown) => void) => void; lastError?: unknown };

// The extension, installed or not, as the page sees it through chrome.runtime.
function extension(installed: boolean) {
  const runtime: Runtime = {
    sendMessage: (id, _message, reply) => {
      if (installed && id === EXTENSION_ID) reply({ ok: false, error: "Not allowed." });
      else {
        runtime.lastError = { message: "Could not establish connection." };
        reply(undefined);
      }
    },
  };
  (globalThis as { chrome?: unknown }).chrome = { runtime };
}

function desktopChrome() {
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_STORE_URL", STORE);
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_ID", EXTENSION_ID);
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(DESKTOP_CHROME);
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// The top bar's "Add Extension" button, for desktop Chrome only.
describe("ExtensionCta", () => {
  it("links to the store in a new tab on desktop Chrome without the extension, and says what it does", async () => {
    desktopChrome();
    extension(false);
    render(<ExtensionCta />);
    const link = await screen.findByRole("link", { name: /Add Extension/ });
    expect(link).toHaveAttribute("href", STORE);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAccessibleDescription(
      "The GiftsAF extension adds the product you're looking at to your list in one click, from any shop, with its name, price and photo.",
    );
  });

  it.each([
    ["Chrome on a phone", ANDROID_CHROME],
    ["Safari", DESKTOP_SAFARI],
  ])("shows nothing on %s", (_, agent) => {
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_STORE_URL", STORE);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(agent);
    const { container } = render(<ExtensionCta />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows when no extension can be reached at all", async () => {
    desktopChrome();
    render(<ExtensionCta />);
    expect(await screen.findByRole("link", { name: /Add Extension/ })).toBeInTheDocument();
  });

  it("shows nothing once the extension answers, so it's installed", async () => {
    desktopChrome();
    const sent: unknown[] = [];
    extension(true);
    const runtime = (globalThis as unknown as { chrome: { runtime: Runtime } }).chrome.runtime;
    const send = runtime.sendMessage;
    runtime.sendMessage = (id, message, reply) => {
      sent.push(message);
      send(id, message, reply);
    };
    const { container } = render(<ExtensionCta />);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
    // A plain check that carries no sign-in token.
    expect(sent[0]).toEqual({ type: "ping" });
  });

  it("shows nothing when the store link isn't set", () => {
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_STORE_URL", "");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(DESKTOP_CHROME);
    const { container } = render(<ExtensionCta />);
    expect(container).toBeEmptyDOMElement();
  });
});
