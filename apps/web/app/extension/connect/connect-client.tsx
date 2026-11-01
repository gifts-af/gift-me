"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Reply = { ok: boolean; error?: string } | undefined;

// Minimal shape of the bit of the Chrome extension API we use, so we don't
// pull @types/chrome into the web app.
type ChromeRuntime = {
  sendMessage: (extensionId: string, message: unknown, callback: (reply: Reply) => void) => void;
  lastError?: { message?: string };
};

type State = "connecting" | "connected" | "not-installed" | "error";

export function ConnectClient({
  action,
}: {
  action: () => Promise<{ tokenHash: string } | { error: string }>;
}) {
  const [state, setState] = useState<State>("connecting");
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  const connect = useCallback(async () => {
    setState("connecting");
    setMessage(null);

    const extensionId = process.env.NEXT_PUBLIC_EXTENSION_ID;
    if (!extensionId) {
      setMessage("The extension ID isn't set up for this site.");
      setState("error");
      return;
    }
    const runtime = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
    if (!runtime?.sendMessage) {
      setState("not-installed");
      return;
    }

    let result: Awaited<ReturnType<typeof action>>;
    try {
      result = await action();
    } catch {
      setMessage("Couldn't reach GiftsAF. Check your connection and try again.");
      setState("error");
      return;
    }
    if ("error" in result) {
      setMessage(result.error);
      setState("error");
      return;
    }

    try {
      runtime.sendMessage(extensionId, { type: "connect", tokenHash: result.tokenHash }, (reply) => {
        if (runtime.lastError || !reply) {
          // Read lastError so Chrome doesn't log it; no reply means no extension.
          setState("not-installed");
        } else if (reply.ok) {
          setState("connected");
        } else {
          setMessage(reply.error ?? "The extension couldn't sign in.");
          setState("error");
        }
      });
    } catch {
      setState("not-installed");
    }
  }, [action]);

  useEffect(() => {
    if (started.current) return; // strict mode mounts twice
    started.current = true;
    void connect();
  }, [connect]);

  return (
    <section className="flex flex-col gap-3" aria-live="polite">
      {state === "connecting" && <p className="text-[15px] text-muted-foreground">Connecting the extension…</p>}
      {state === "connected" && (
        <p role="status" className="text-[15px] text-success">
          Extension connected. You can close this tab.
        </p>
      )}
      {state === "not-installed" && (
        <>
          <p className="text-[15px]">We couldn&apos;t reach the GiftsAF extension.</p>
          <p className="text-[15px] text-muted-foreground">
            Load the GiftsAF extension in Chrome (see apps/extension/README.md), then reload this page. Ask Aaron or
            Jim for the extension folder.
          </p>
          <Button type="button" variant="outline" onClick={() => location.reload()} className="w-full sm:w-auto">
            Reload this page
          </Button>
        </>
      )}
      {state === "error" && (
        <>
          <p role="alert" className="text-[15px] text-destructive">
            {message}
          </p>
          <Button type="button" variant="outline" onClick={() => void connect()} className="w-full sm:w-auto">
            Try again
          </Button>
        </>
      )}
    </section>
  );
}
