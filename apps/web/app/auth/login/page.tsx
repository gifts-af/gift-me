import { Suspense } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { LoginForm } from "@/components/login-form";

// Search params are runtime data, so the form renders inside <Suspense>
// under cacheComponents.
async function Form({ searchParams }: PageProps<"/auth/login">) {
  const { next } = await searchParams;
  return <LoginForm next={typeof next === "string" ? next : undefined} />;
}

export default function Page(props: PageProps<"/auth/login">) {
  return (
    <AuthFrame>
      <Suspense>
        <Form {...props} />
      </Suspense>
    </AuthFrame>
  );
}
