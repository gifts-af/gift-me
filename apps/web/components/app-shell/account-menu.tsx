"use client";

import { Laptop, LogOut, Moon, Puzzle, Settings, Sun, User } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useExtensionInstalled, useExtensionStoreUrl } from "@/components/extension-link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { finishBeforeLeaving } from "@/lib/leaving-page";
import { createClient } from "@/lib/supabase/client";

// Settings, the light/dark switch and sign-out, behind one icon
// (design/ui.md > Colours: the manual switch lives in the account menu).
export function AccountMenu({ email }: { email?: string | null }) {
  const { theme, setTheme } = useTheme();
  const storeUrl = useExtensionStoreUrl();
  const installed = useExtensionInstalled(storeUrl !== null);

  async function signOut() {
    // My list may still be sending a remove held for Undo (ALL-127).
    await finishBeforeLeaving();
    await createClient().auth.signOut();
    // A full page load, so no signed-in page survives in the router cache.
    window.location.assign("/auth/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Account">
          <User aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {email && (
          <>
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem asChild className="min-h-11">
          <Link href="/settings">
            <Settings aria-hidden="true" />
            Settings
          </Link>
        </DropdownMenuItem>
        {/* Desktop Chrome only, until it's installed; opens a new tab, so the page isn't left. */}
        {storeUrl && installed === false && (
          <DropdownMenuItem asChild className="min-h-11">
            <a href={storeUrl} target="_blank" rel="noreferrer">
              <Puzzle aria-hidden="true" />
              Get the Chrome extension
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="system" className="min-h-11">
            <Laptop aria-hidden="true" /> Match my device
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light" className="min-h-11">
            <Sun aria-hidden="true" /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" className="min-h-11">
            <Moon aria-hidden="true" /> Dark
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {/* Leaves the page without being a link, so the list's failed-save check needs telling (ALL-95). */}
        <DropdownMenuItem data-leaves-page="" onSelect={signOut} className="min-h-11">
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
