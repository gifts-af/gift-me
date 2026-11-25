import Link from "next/link";
import { Suspense } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { withNext } from "@/lib/safe-next";

// Supabase sends no email when the address already has an account, and doesn't
// say so, so nobody can find out who has one. This page helps in both cases.
async function Body({ searchParams }: PageProps<"/auth/sign-up-success">) {
  const { next } = await searchParams;
  const back = typeof next === "string" ? next : undefined;
  return (
    <>
      <p className="rounded-lg bg-accent p-3 text-sm text-accent-foreground">
        Check your email for a link to confirm your account. Nothing after a few minutes? Check spam. If you already have an account,{" "}
        <Link href={withNext("/auth/login", back)} className="underline underline-offset-[3px]">
          sign in
        </Link>
        .
      </p>
      <Button asChild variant="link" size="sm" className="self-center">
        <Link href={withNext("/auth/sign-up", back)}>Back to sign-up</Link>
      </Button>
    </>
  );
}

export default function Page(props: PageProps<"/auth/sign-up-success">) {
  return (
    <AuthFrame title="Check your email" subtitle="">
      <Suspense>
        <Body {...props} />
      </Suspense>
    </AuthFrame>
  );
}
