import { redirect } from "next/navigation";
import { AccessCheckFailed, readAccess } from "@/components/concierge-gate";

/** Sends you to Give with concierge access, or My list without. A failed check is neither. */
export async function SendHome() {
  const state = await readAccess();
  if (!state) return <AccessCheckFailed />;
  redirect(state.access ? "/give" : "/lists");
}
