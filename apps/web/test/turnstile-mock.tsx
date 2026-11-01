import { useEffect } from "react";
import type { TurnstileProps } from "@marsidev/react-turnstile";

// Stands in for Cloudflare's widget in unit tests (ALL-68), which can't load
// its script. Like the real one, it hands over a token and puts it in a hidden
// form field. Set autoToken to false to test a form still waiting for it.
export const turnstileMock = { autoToken: true, renders: 0 };

export function Turnstile({ onSuccess, options }: TurnstileProps) {
  const auto = turnstileMock.autoToken;
  useEffect(() => {
    turnstileMock.renders += 1;
    if (auto) onSuccess?.("test-token");
  }, [auto, onSuccess]);
  const field = options?.responseFieldName ?? "cf-turnstile-response";
  return auto ? <input type="hidden" name={field} value="test-token" readOnly /> : null;
}
