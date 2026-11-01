import type { SupportedStorage } from "@supabase/supabase-js";

// supabase-js session storage backed by chrome.storage.local, so the popup and
// the service worker share one session and it survives a browser restart.
export const chromeStorage: SupportedStorage = {
  async getItem(key) {
    const result = await chrome.storage.local.get(key);
    const value = result[key];
    return typeof value === "string" ? value : null;
  },
  async setItem(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key) {
    await chrome.storage.local.remove(key);
  },
};
