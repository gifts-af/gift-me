"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { LinkView } from "@/modules/concierge";
import { confirmLink } from "./actions";
import { LinkMessage, LinkState } from "./link-states";

type Confirm = Extract<LinkView, { state: "confirm" }>["confirm"];

// The action's words and one button that posts (ALL-23, AC-4). Afterwards it
// shows what the server said: done (AC-10), or why not.
export function ConfirmForm({ token, confirm }: { token: string; confirm: Confirm }) {
  const [result, action, pending] = useActionState(confirmLink.bind(null, token), null);

  if (result) return <LinkState view={result} token={token} />;

  return (
    <LinkMessage title={confirm.title} body={confirm.body}>
      <form action={action}>
        <Button type="submit" className="w-full" disabled={pending} aria-busy={pending}>
          {confirm.button}
        </Button>
      </form>
    </LinkMessage>
  );
}
