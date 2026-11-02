import Link from "next/link";
import { GoogleButton } from "@/components/google-button";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/brand";
import type { ConfirmResult } from "@/modules/concierge";
import { SignOutAndReturn } from "./sign-out-and-return";

// Every /a/{token} screen except the confirm form (ALL-23, AC-5 to AC-10).
// Shared by the page (what a GET shows) and the confirm form (what a POST
// returned), so both say the same thing.

export function LinkMessage({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5 text-center">
        <h2 className="text-[20px] font-bold leading-tight">{title}</h2>
        <p className="text-[15px] text-muted-foreground">{body}</p>
      </div>
      {children}
    </section>
  );
}

function HomeLink({ variant = "default" }: { variant?: "default" | "outline" }) {
  return (
    <Button asChild variant={variant} className="w-full">
      <Link href="/">Go to {APP_NAME}</Link>
    </Button>
  );
}

export function LinkState({ view, token }: { view: ConfirmResult; token: string }) {
  const here = `/a/${token}`;
  switch (view.state) {
    case "sign_in":
      return (
        <LinkMessage title="Sign in to continue" body="Use the account this email was sent to.">
          <GoogleButton next={here} loginHint={view.email ?? undefined} />
          <Button asChild variant="link" size="sm" className="self-center">
            <Link href={`/auth/login?next=${encodeURIComponent(here)}`}>Sign in with email</Link>
          </Button>
        </LinkMessage>
      );
    case "wrong_account":
      return (
        <LinkMessage title="This link is for a different account" body="Sign in with the account this email was sent to.">
          <SignOutAndReturn next={here} />
          <HomeLink variant="outline" />
        </LinkMessage>
      );
    case "used":
      return (
        <LinkMessage title="This link has already been used" body="Each link works once, so there's nothing more to do here.">
          <HomeLink />
        </LinkMessage>
      );
    case "expired":
      return (
        <LinkMessage title="This link has expired" body={`Open ${APP_NAME} to pick up where you left off.`}>
          <HomeLink />
        </LinkMessage>
      );
    case "invalid":
      return (
        <LinkMessage title="This link doesn't work" body="Check that the whole link was copied from the email.">
          <HomeLink />
        </LinkMessage>
      );
    case "done":
      // AC-10: the action's own words, then home.
      return (
        <LinkMessage title={view.done.title} body={view.done.body}>
          {view.next ? (
            <Button asChild className="w-full">
              <Link href={view.next}>Open their page</Link>
            </Button>
          ) : (
            <HomeLink />
          )}
        </LinkMessage>
      );
  }
}
