import { Suspense } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

async function Form({ searchParams }: PageProps<"/auth/forgot-password">) {
  const { next } = await searchParams;
  return <ForgotPasswordForm next={typeof next === "string" ? next : undefined} />;
}

export default function Page(props: PageProps<"/auth/forgot-password">) {
  return (
    <AuthFrame title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      <Suspense>
        <Form {...props} />
      </Suspense>
    </AuthFrame>
  );
}
