"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";

// A light/dark switch for every visitor (ALL-74). With no choice made the site
// follows the device (next-themes "system"); a tap saves an explicit choice on
// this device, the same setting the account menu's Theme picks. Some phones
// report dark without the person knowing (battery saver, schedules), so
// everyone needs a way out.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // The theme is only known in the browser; until then the icons follow the
  // page's class and the label stays generic.
  const hydrated = useHydrated();
  const dark = resolvedTheme === "dark";
  const label = !hydrated ? "Switch theme" : dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11"
      aria-label={label}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      <Moon className="dark:hidden" aria-hidden="true" />
      <Sun className="hidden dark:block" aria-hidden="true" />
    </Button>
  );
}
