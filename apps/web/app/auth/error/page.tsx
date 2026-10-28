import Link from "next/link";
import { Suspense } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { authErrorMessage } from "@/lib/auth-errors";

async function ErrorMessage({ searchParams }: PageProps<"/auth/error">) {
  const { error } = await searchParams;
  return (
    <p className="text-center text-[15px] text-muted-foreground">
      {authErrorMessage(typeof error === "string" ? error : undefined)}
    </p>
  );
}

export default function Page(props: PageProps<"/auth/error">) {
  return (
    <AuthFrame title="Sign-in didn't work" subtitle="">
      <Suspense>
        <ErrorMessage {...props} />
      </Suspense>
      <Button asChild className="w-full">
        <Link href="/auth/login">Try again</Link>
      </Button>
    </AuthFrame>
  );
}
