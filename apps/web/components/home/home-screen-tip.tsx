import { unstable_rethrow } from "next/navigation";
import { InstallTip } from "@/components/app-shell/install-tip";
import { appSettingInt } from "@/lib/app-settings";

// Phones only, and only outside the installed app (ALL-57). A tip never
// breaks Home: if its setting can't be read, it just isn't shown.
export async function HomeScreenTip() {
  try {
    return <InstallTip snoozeDays={await appSettingInt("install_tip_snooze_days")} />;
  } catch (error) {
    unstable_rethrow(error); // Next's end-of-prerender signal isn't a failure (ALL-87).
    console.error("install tip hidden", error);
    return null;
  }
}
