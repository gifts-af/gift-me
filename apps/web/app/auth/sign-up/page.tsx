import { Suspense } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { SignUpForm } from "@/components/sign-up-form";

async function Form({ searchParams }: PageProps<"/auth/sign-up">) {
  const { next } = await searchParams;
  return <SignUpForm next={typeof next === "string" ? next : undefined} />;
}

export default function Page(props: PageProps<"/auth/sign-up">) {
  return (
    <AuthFrame title="Create an account" subtitle="">
      <Suspense>
        <Form {...props} />
      </Suspense>
    </AuthFrame>
  );
}
