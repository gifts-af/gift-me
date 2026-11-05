import { canCapture } from "../lib/page";
import { getSupabase } from "../lib/supabase";
import type { Person } from "./PersonPicker";

export type Loaded = {
  kind: "ready";
  people: Person[];
  /** concierge.app_settings capture_text_max_chars; never defaulted here (T23). */
  textMax: number;
  /** concierge.app_settings capture_screenshot_max_bytes; never defaulted here (T23). */
  screenshotMaxBytes: number;
  /** Whether this user's captures get read (ALL-94). */
  paidFeatures: boolean;
  /** concierge.app_settings capture_read_estimate_cents; never defaulted here (T23). */
  readEstimateCents: number;
  tabId: number | null;
  capturable: boolean;
};

export type LoadResult = Loaded | { kind: "signedOut" } | { kind: "error" };

// What the popup needs when it opens. The page itself isn't read here: the
// only thing run in the tab is the canCapture probe (C-2).
export async function loadPopup(): Promise<LoadResult> {
  try {
    const supabase = getSupabase();
    // getSession refreshes an expired access token using the stored refresh token.
    const { data } = await supabase.auth.getSession();
    if (!data.session) return { kind: "signedOut" };

    const [people, cap, shotCap, paid, estimate, tabs] = await Promise.all([
      supabase.from("people").select("id, name").order("name"),
      supabase.schema("concierge").rpc("setting_int", { p_key: "capture_text_max_chars" }),
      supabase.schema("concierge").rpc("setting_int", { p_key: "capture_screenshot_max_bytes" }),
      supabase.schema("concierge").rpc("has_paid_features", { p_user_id: data.session.user.id }),
      supabase.schema("concierge").rpc("setting_int", { p_key: "capture_read_estimate_cents" }),
      chrome.tabs.query({ active: true, currentWindow: true }),
    ]);
    if (people.error || !people.data) return { kind: "error" };
    if (cap.error || typeof cap.data !== "number") return { kind: "error" };
    if (shotCap.error || typeof shotCap.data !== "number") return { kind: "error" };
    if (paid.error || typeof paid.data !== "boolean") return { kind: "error" };
    if (estimate.error || typeof estimate.data !== "number") return { kind: "error" };

    const tabId = tabs[0]?.id ?? null;
    const capturable = tabId !== null && (await canCapture(tabId));
    return {
      kind: "ready",
      people: people.data,
      textMax: cap.data,
      screenshotMaxBytes: shotCap.data,
      paidFeatures: paid.data,
      readEstimateCents: estimate.data,
      tabId,
      capturable,
    };
  } catch {
    return { kind: "error" };
  }
}
