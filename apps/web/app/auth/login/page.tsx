import { Suspense } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { LoginForm } from "@/components/login-form";
import Link from "next/link";
import { APP_NAME } from "@/lib/brand";

// Search params are runtime data, so the form renders inside <Suspense>
// under cacheComponents.
async function Form({ searchParams }: PageProps<"/auth/login">) {
  const { next } = await searchParams;
  return <LoginForm next={typeof next === "string" ? next : undefined} />;
}

export default function Page(props: PageProps<"/auth/login">) {
  return (
    <AuthFrame>
      {/* Invite only for now (ALL-46): say so, and offer a way to ask. */}
      <p className="text-center text-[14px] text-muted-foreground">
        {APP_NAME} is invite only for now. No invite?{" "}
        <Link href="/request-access" className="inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-[3px]">
          Request access
        </Link>
      </p>
      <Suspense>
        <Form {...props} />
      </Suspense>
    </AuthFrame>
  );
}
