import { AuthFrame } from "@/components/auth-frame";
import type { LinkView } from "@/modules/concierge";
import { ConfirmForm } from "./confirm-form";
import { LinkState } from "./link-states";

// What /a/{token} shows for a LinkView, in the sign-in look. Pure, so each
// state can be tested without the async page.
export function ActionLinkView({ view, token }: { view: LinkView; token: string }) {
  return (
    <AuthFrame subtitle="">
      {view.state === "confirm" ? (
        <ConfirmForm token={token} confirm={view.confirm} />
      ) : (
        <LinkState view={view} token={token} />
      )}
    </AuthFrame>
  );
}
