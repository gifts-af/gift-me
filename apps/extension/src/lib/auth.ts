import { getSupabase } from "./supabase";

export type ConnectResult = { ok: true } | { ok: false; error: string };

// Exchanges the one-time token hash from the web app for this extension's own session.
export async function connect(tokenHash: string): Promise<ConnectResult> {
  try {
    const { error } = await getSupabase().auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    if (error) return { ok: false, error: "Couldn't connect. Try again from the web app." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't connect. Check your connection and try again." };
  }
}

// Signs out of this browser only; the web app session is untouched.
export async function signOut(): Promise<void> {
  try {
    await getSupabase().auth.signOut({ scope: "local" });
  } catch {
    // Network errors are fine: local scope clears the stored session regardless.
  }
}
