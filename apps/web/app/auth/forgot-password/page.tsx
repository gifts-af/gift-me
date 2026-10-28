import { AuthFrame } from "@/components/auth-frame";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default function Page() {
  return (
    <AuthFrame title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      <ForgotPasswordForm />
    </AuthFrame>
  );
}
