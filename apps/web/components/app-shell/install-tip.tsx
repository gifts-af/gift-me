"use client";

import { EllipsisVertical, Share, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/brand";
import { type InstallPlatform, installPlatform, isRunningInstalled, isSnoozed } from "@/lib/install-tip";

// "Not now" is remembered per device: installing is per device too.
const DISMISSED_KEY = "giftsaf:install-tip-dismissed-at";

// Chrome's install offer (not yet in TypeScript's DOM types).
type InstallOffer = Event & { prompt: () => Promise<void> };

function readDismissedAt(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function saveDismissedAt(value: string) {
  try {
    localStorage.setItem(DISMISSED_KEY, value);
  } catch {
    // Storage blocked (private mode): the tip just comes back next visit.
  }
}

/**
 * Invites phone users to add GiftsAF to their Home Screen (ALL-57). Hidden
 * when opened from the Home Screen, on computers, and while snoozed. A page
 * can't tell that the app is installed when it's opened in a browser tab, so
 * "Not now" covers that case.
 */
export function InstallTip({ snoozeDays }: { snoozeDays: number }) {
  const [platform, setPlatform] = useState<InstallPlatform | null>(null);
  const [offer, setOffer] = useState<InstallOffer | null>(null);

  useEffect(() => {
    const found = installPlatform(navigator.userAgent, navigator.maxTouchPoints);
    const installed = isRunningInstalled({
      matchMedia: (query) => window.matchMedia(query),
      navigator: navigator as Navigator & { standalone?: boolean },
    });
    if (!found || installed || isSnoozed(readDismissedAt(), new Date(), snoozeDays)) return;
    // Reads browser-only state after mount, so the server render stays empty.
    setPlatform(found);

    const onOffer = (event: Event) => {
      event.preventDefault(); // We show our own button instead of Chrome's banner.
      setOffer(event as InstallOffer);
    };
    const onInstalled = () => setPlatform(null);
    window.addEventListener("beforeinstallprompt", onOffer);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onOffer);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [snoozeDays]);

  if (!platform) return null;

  // Chrome's offer works once; if they decline, the menu steps show instead.
  async function install(current: InstallOffer) {
    await current.prompt().catch(() => {});
    setOffer(null);
  }

  function notNow() {
    saveDismissedAt(new Date().toISOString());
    setPlatform(null);
  }

  return (
    <section
      aria-labelledby="install-tip-heading"
      className="flex items-start gap-3 rounded-lg border bg-card p-3 sm:max-w-md"
    >
      <span className="grid size-10 flex-none place-items-center rounded-md bg-muted text-muted-foreground">
        <Smartphone className="size-5" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <h2 id="install-tip-heading" className="text-[15px] font-semibold">
            Add {APP_NAME} to your Home Screen
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {platform === "ios" ? (
              <>
                Tap <Share className="inline size-4 align-text-bottom" aria-label="Share" /> Share, then{" "}
                <strong>Add to Home Screen</strong>.
              </>
            ) : offer ? (
              <>Open it like an app, right from your phone.</>
            ) : (
              <>
                Tap <EllipsisVertical className="inline size-4 align-text-bottom" aria-label="the menu" /> menu,
                then <strong>Add to Home screen</strong>.
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {platform === "android" && offer && (
            <Button type="button" size="sm" onClick={() => void install(offer)}>
              Install
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={notNow}>
            Not now
          </Button>
        </div>
      </div>
    </section>
  );
}
