import { AuthFrame } from "@/components/auth-frame";

export default function Page() {
  return (
    <AuthFrame title="Check your email" subtitle="">
      <p className="rounded-lg bg-accent p-3 text-sm text-accent-foreground">
        We sent you a link to confirm your account. Open it on this device to finish signing up.
      </p>
    </AuthFrame>
  );
}
