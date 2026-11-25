import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AccessCheckFailed, readAccess } from "@/components/concierge-gate";
import { HOME_TAB_COOKIE, homePath } from "@/lib/home-tab";

/** Sends you to My list, or to Give if this browser last used it and you have concierge access. A failed check is neither. */
export async function SendHome() {
  const state = await readAccess();
  if (!state) return <AccessCheckFailed />;
  const lastTab = (await cookies()).get(HOME_TAB_COOKIE)?.value;
  redirect(homePath(lastTab, state.access));
}
