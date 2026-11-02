import { ACTIONS, type Action, type ActionResult } from "./actions";
import type { NotifyStore } from "./store";
import { hashActionToken } from "./tokens";

// Reading and confirming one-time action links (ALL-23, AC-3 to AC-10).
// Reading never changes anything (an email scanner's GET must not use the link
// up); only confirm, from the page's POST, claims the link and runs the action.

/** What the /a/{token} page shows. Action text appears only in `confirm`. */
export type LinkView =
  | { state: "invalid" }
  | { state: "sign_in"; email: string | null }
  | { state: "wrong_account" }
  | { state: "used" }
  | { state: "expired" }
  | { state: "confirm"; confirm: Action["confirm"] };

export type ConfirmResult =
  | { state: "done"; done: Action["done"] }
  | Exclude<LinkView, { state: "confirm" }>;

export type LinkDeps = { store: NotifyStore; now: Date };

/**
 * The action a saved link names, or null when this build doesn't have it: the
 * dev database is shared across previews and a rollback can meet newer links.
 * Object.hasOwn keeps prototype names like "constructor" out.
 */
function actionFor(name: string): Action | null {
  return Object.hasOwn(ACTIONS, name) ? ACTIONS[name as keyof typeof ACTIONS] : null;
}

/**
 * The spec's check order; the first that applies decides: unknown token,
 * signed out, someone else, used, expired, otherwise confirm.
 */
export async function readActionLink(
  token: string,
  viewerId: string | null,
  { store, now }: LinkDeps,
): Promise<LinkView> {
  const link = await store.findLink(hashActionToken(token));
  if (!link) return { state: "invalid" };
  const action = actionFor(link.action);
  if (!action) return { state: "invalid" };
  if (viewerId === null) {
    const { email } = await store.recipient(link.userId);
    return { state: "sign_in", email };
  }
  if (viewerId !== link.userId) return { state: "wrong_account" };
  if (link.usedAt) return { state: "used" };
  // Same boundary as claimLink (expires_at > now): at the expiry instant it's expired.
  if (link.expiresAt.getTime() <= now.getTime()) return { state: "expired" };
  return { state: "confirm", confirm: action.confirm };
}

export async function confirmActionLink(
  token: string,
  viewerId: string | null,
  deps: LinkDeps,
): Promise<ConfirmResult> {
  const view = await readActionLink(token, viewerId, deps);
  if (view.state !== "confirm") return view;

  // readActionLink only says "confirm" for the signed-in owner.
  const userId = viewerId as string;
  const claimed = await deps.store.claimLink(hashActionToken(token), userId, deps.now);
  // Someone else's confirm claimed it between our read and this claim.
  if (!claimed) return { state: "used" };

  const action = actionFor(claimed.action);
  if (!action) return { state: "invalid" };
  const result = await runSafely(action, claimed.userId, claimed.roundId);
  if (!result.ok) {
    // [Claude's call] The link stays used: real actions must be safe to treat as
    // done or report their own failure. Never log the raw token.
    console.error(`Action link "${claimed.action}" failed for user ${userId}: ${result.error}`);
    return { state: "invalid" };
  }
  return { state: "done", done: action.done };
}

/** A throwing action counts as a failed one, so the page still answers. */
async function runSafely(
  action: Action,
  userId: string,
  roundId: string | null,
): Promise<ActionResult> {
  try {
    return await action.run({ userId, roundId });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
