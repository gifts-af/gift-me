import Link from "next/link";
import { Suspense } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { SignUpForm } from "@/components/sign-up-form";

async function Form({ searchParams }: PageProps<"/auth/sign-up">) {
  const { next } = await searchParams;
  return <SignUpForm next={typeof next === "string" ? next : undefined} />;
}

export default function Page(props: PageProps<"/auth/sign-up">) {
  return (
    <AuthFrame subtitle="Free. Make a wish list, share one link, and keep your family's lists in one place.">
      <Suspense>
        <Form {...props} />
      </Suspense>
      <Link
        href="/privacy"
        className="inline-flex min-h-11 items-center self-center text-[13px] text-muted-foreground underline underline-offset-[3px] hover:text-foreground"
      >
        Privacy
      </Link>
    </AuthFrame>
  );
}
