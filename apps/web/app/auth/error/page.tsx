import Link from "next/link";
import { Suspense } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { authErrorMessage } from "@/lib/auth-errors";
import { withNext } from "@/lib/safe-next";

async function Body({ searchParams }: PageProps<"/auth/error">) {
  const { error, next } = await searchParams;
  return (
    <>
      <p className="text-center text-[15px] text-muted-foreground">
        {authErrorMessage(typeof error === "string" ? error : undefined)}
      </p>
      <Button asChild className="w-full">
        <Link href={withNext("/auth/login", typeof next === "string" ? next : undefined)}>Try again</Link>
      </Button>
    </>
  );
}

export default function Page(props: PageProps<"/auth/error">) {
  return (
    <AuthFrame title="Sign-in didn't work" subtitle="">
      <Suspense>
        <Body {...props} />
      </Suspense>
    </AuthFrame>
  );
}
