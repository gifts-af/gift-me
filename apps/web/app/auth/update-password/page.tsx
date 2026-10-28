import { AuthFrame } from "@/components/auth-frame";
import { UpdatePasswordForm } from "@/components/update-password-form";

export default function Page() {
  return (
    <AuthFrame title="Choose a new password" subtitle="">
      <UpdatePasswordForm />
    </AuthFrame>
  );
}
