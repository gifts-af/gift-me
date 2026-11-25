"use client";

import { useEffect } from "react";
import { homeTabCookie, type HomeTab } from "@/lib/home-tab";

// Remembers the tab of the page actually open, so "/" reopens it (T98).
export function RememberHomeTab({ tab }: { tab: HomeTab }) {
  useEffect(() => {
    document.cookie = homeTabCookie(tab, window.location.protocol === "https:");
  }, [tab]);
  return null;
}
