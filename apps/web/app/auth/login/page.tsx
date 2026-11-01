import { Suspense } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { LoginForm } from "@/components/login-form";
import { APP_NAME, accessRequestHref } from "@/lib/brand";

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
        <a href={accessRequestHref()} className="inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-[3px]">
          Request access
        </a>
      </p>
      <Suspense>
        <Form {...props} />
      </Suspense>
    </AuthFrame>
  );
}
