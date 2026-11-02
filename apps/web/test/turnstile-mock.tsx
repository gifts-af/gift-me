import { useEffect } from "react";
import type { TurnstileProps } from "@marsidev/react-turnstile";

// Stands in for Cloudflare's widget in unit tests (ALL-68), which can't load
// its script. Like the real one, it hands over a token and puts it in a hidden
// form field. Set autoToken to false to test a form still waiting for it, or
// fails to true to test a visitor Cloudflare won't pass (ALL-69).
export const turnstileMock = { autoToken: true, fails: false, renders: 0 };

export function Turnstile({ onSuccess, onError, options }: TurnstileProps) {
  const auto = turnstileMock.autoToken && !turnstileMock.fails;
  const fails = turnstileMock.fails;
  useEffect(() => {
    turnstileMock.renders += 1;
    if (fails) onError?.("600010");
    else if (auto) onSuccess?.("test-token");
  }, [auto, fails, onSuccess, onError]);
  const field = options?.responseFieldName ?? "cf-turnstile-response";
  return auto ? <input type="hidden" name={field} value="test-token" readOnly /> : null;
}
