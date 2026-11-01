import Link from "next/link";
import { RequestAccessButton } from "@/components/home/request-access-dialog";

export function EndScreen() {
  return (
    <div className="mx-auto flex w-full max-w-[375px] flex-col gap-4 text-center">
      <p className="text-[17px]">A lot is still broken, but your gift list works today. Want in?</p>
      <RequestAccessButton className="inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-6 font-bold text-primary-foreground hover:bg-primary/90" />
      <Link
        href="/auth/login"
        className="inline-flex min-h-11 items-center justify-center text-[15px] text-muted-foreground underline underline-offset-[3px] hover:text-foreground"
      >
        Have an invite? Sign in
      </Link>
      <Link href="/" className="inline-flex min-h-11 items-center justify-center text-[15px] font-semibold">
        Back to home
      </Link>
    </div>
  );
}
