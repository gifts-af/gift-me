import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { AccountMenu } from "./account-menu";

async function SignedInAccount() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  return <AccountMenu email={email} />;
}

// Reads the session cookie, so it streams in behind its own boundary and the
// rest of the bar renders straight away.
export function Account() {
  return (
    <Suspense fallback={<span className="size-11" aria-hidden="true" />}>
      <SignedInAccount />
    </Suspense>
  );
}
