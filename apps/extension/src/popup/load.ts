import { readProductPage, type ProductPage } from "../lib/page";
import { getSupabase } from "../lib/supabase";
import type { Person } from "./PeopleScreen";

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
  /** concierge.app_settings list_photo_width_px; never defaulted here (T23). */
  photoWidthPx: number;
  /** concierge.app_settings list_photo_jpeg_quality, 0..100; never defaulted here (T23). */
  photoJpegQuality: number;
  /** The people captured for most recently, padded alphabetically to RECENT_COUNT. */
  recentPeople: Person[];
  tabId: number | null;
  /** The page could be scripted and read (false on chrome:// pages and the like). */
  capturable: boolean;
  /** What the page showed when the popup opened; null when it can't be read. */
  page: ProductPage | null;
};

// How many quick-pick people the popup shows.
const RECENT_COUNT = 3;

export type LoadResult = Loaded | { kind: "signedOut" } | { kind: "error" };

async function readActiveTab(): Promise<{ tabId: number | null; page: ProductPage | null }> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id ?? null;
    if (tabId === null) return { tabId, page: null };
    try {
      return { tabId, page: await readProductPage(tabId) };
    } catch {
      return { tabId, page: null };
    }
  } catch {
    return { tabId: null, page: null };
  }
}

// What the popup needs when it opens, including the page read in the tab. The
// read stays on this device until the user saves (C-2).
export async function loadPopup(): Promise<LoadResult> {
  try {
    const supabase = getSupabase();
    // getSession refreshes an expired access token using the stored refresh token.
    const { data } = await supabase.auth.getSession();
    if (!data.session) return { kind: "signedOut" };

    // The tab is read while the settings load; a tab that can't be scripted
    // (chrome://, Web Store) or a failed read gives page: null.
    const tab = readActiveTab();
    const [people, cap, shotCap, paid, estimate, photoWidth, photoQuality, recent] = await Promise.all([
      supabase.from("people").select("id, name").order("name"),
      supabase.schema("concierge").rpc("setting_int", { p_key: "capture_text_max_chars" }),
      supabase.schema("concierge").rpc("setting_int", { p_key: "capture_screenshot_max_bytes" }),
      supabase.schema("concierge").rpc("has_paid_features", { p_user_id: data.session.user.id }),
      supabase.schema("concierge").rpc("setting_int", { p_key: "capture_read_estimate_cents" }),
      supabase.schema("concierge").rpc("setting_int", { p_key: "list_photo_width_px" }),
      supabase.schema("concierge").rpc("setting_int", { p_key: "list_photo_jpeg_quality" }),
      supabase.schema("concierge").rpc("recent_people", { p_limit: RECENT_COUNT }),
    ]);
    if (people.error || !people.data) return { kind: "error" };
    if (cap.error || typeof cap.data !== "number") return { kind: "error" };
    if (shotCap.error || typeof shotCap.data !== "number") return { kind: "error" };
    if (paid.error || typeof paid.data !== "boolean") return { kind: "error" };
    if (estimate.error || typeof estimate.data !== "number") return { kind: "error" };
    if (photoWidth.error || typeof photoWidth.data !== "number") return { kind: "error" };
    if (photoQuality.error || typeof photoQuality.data !== "number") return { kind: "error" };

    // Missing or failed recents just mean an all-alphabetical row.
    const byId = new Map(people.data.map((p) => [p.id, p]));
    const recentPeople: Person[] = [];
    for (const row of recent.error ? [] : (recent.data ?? [])) {
      const person = byId.get(row.person_id);
      if (person && !recentPeople.includes(person)) recentPeople.push(person);
    }
    for (const person of people.data) {
      if (recentPeople.length >= RECENT_COUNT) break;
      if (!recentPeople.includes(person)) recentPeople.push(person);
    }
    recentPeople.length = Math.min(recentPeople.length, RECENT_COUNT);

    const { tabId, page } = await tab;
    return {
      kind: "ready",
      people: people.data,
      textMax: cap.data,
      screenshotMaxBytes: shotCap.data,
      paidFeatures: paid.data,
      readEstimateCents: estimate.data,
      photoWidthPx: photoWidth.data,
      photoJpegQuality: photoQuality.data,
      recentPeople,
      tabId,
      capturable: page !== null,
      page,
    };
  } catch {
    return { kind: "error" };
  }
}
