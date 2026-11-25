// Where "/" sends a signed-in person: their own list (Get) unless this browser
// remembers them last choosing Give. A new browser, or a first sign-in, opens
// My list. The cookie holds only "get" or "give", never anything personal.
export const HOME_TAB_COOKIE = "home_tab";

// Browsers cap a cookie's life at 400 days, so this is "as long as allowed".
export const HOME_TAB_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

type Tab = "get" | "give";

const TAB_PATHS: Record<string, Tab> = { "/lists": "get", "/give": "give" };

/** The page "/" goes to. Give needs concierge access too; anything else is My list. */
export function homePath(lastTab: string | undefined, access: boolean): "/lists" | "/give" {
  return lastTab === "give" && access ? "/give" : "/lists";
}

/** The tab to remember on opening `pathname`, or null when it's not a tab page or is already remembered. */
export function tabToRemember(pathname: string, current: string | undefined): Tab | null {
  const tab = TAB_PATHS[pathname] ?? null;
  return tab && tab !== current ? tab : null;
}
