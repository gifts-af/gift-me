import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/app-shell/page-frame";

// What a /rounds page shows someone signed in as another account (AC-3): this line and
// nothing of the round, its ideas or its person. Shared by the round, confirm and fix pages.
export function OtherAccount() {
  return (
    <>
      <PageTitle>This gift belongs to another account</PageTitle>
      <p className="text-[15px] text-muted-foreground">Sign in with the account the email was sent to.</p>
      <Button asChild variant="outline" className="self-start">
        <Link href="/give">Go to your people</Link>
      </Button>
    </>
  );
}
