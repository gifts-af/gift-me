import { connect } from "./lib/auth";
import { config } from "./lib/config";

const NOT_ALLOWED = { ok: false, error: "Not allowed." } as const;

function senderOrigin(sender: { url?: string; origin?: string }): string | null {
  if (sender.origin) return sender.origin;
  try {
    return sender.url ? new URL(sender.url).origin : null;
  } catch {
    return null;
  }
}

// The web app sends { type: "connect", tokenHash } from its /extension/connect page.
// Never log the message: it carries a one-time sign-in token.
function handleExternalMessage(
  message: unknown,
  sender: { url?: string; origin?: string },
  sendResponse: (response: unknown) => void,
): boolean {
  const tokenHash =
    typeof message === "object" && message !== null && (message as { type?: unknown }).type === "connect"
      ? (message as { tokenHash?: unknown }).tokenHash
      : undefined;
  if (senderOrigin(sender) !== config.appOrigin || typeof tokenHash !== "string" || tokenHash === "") {
    sendResponse(NOT_ALLOWED);
    return false;
  }
  void connect(tokenHash).then(sendResponse);
  return true; // keep the channel open for the async reply
}

chrome.runtime.onMessageExternal.addListener(handleExternalMessage);
