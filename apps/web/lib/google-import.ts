import { unstable_rethrow } from "next/navigation";
import { appSettingInt } from "@/lib/app-settings";
import { logEvent } from "@/lib/log";

/** Whether importing from Google Contacts is on. A setting that can't be read counts as off. */
export async function googleImportEnabled(): Promise<boolean> {
  try {
    return (await appSettingInt("google_import_enabled")) === 1;
  } catch (error) {
    unstable_rethrow(error);
    logEvent("google_import_check_failed", { error: error instanceof Error ? error.name : "unknown" });
    return false;
  }
}
