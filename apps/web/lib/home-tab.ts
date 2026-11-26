// Where "/" sends a signed-in person: their own list (Get) unless this browser
// remembers them last using Give. A new browser, or a first sign-in, opens My
// list. The cookie holds only "get" or "give", never anything personal. The
// page writes it, not the proxy, because link prefetches pass through the proxy
// and would remember a tab nobody opened.
export const HOME_TAB_COOKIE = "home_tab";

// Browsers cap a cookie's life at 400 days, so this is "as long as allowed".
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export type HomeTab = "get" | "give";

/** The page "/" goes to: Give if it was the last tab used here, otherwise My list. */
export function homePath(lastTab: string | undefined): "/lists" | "/give" {
  return lastTab === "give" ? "/give" : "/lists";
}

/** The `document.cookie` line that remembers `tab` in this browser. */
export function homeTabCookie(tab: HomeTab, secure: boolean): string {
  return `${HOME_TAB_COOKIE}=${tab}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
