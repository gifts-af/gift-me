import Link from "next/link";

export const END_PRIMARY =
  "inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-6 font-bold text-primary-foreground hover:bg-primary/90";
export const END_LINK =
  "inline-flex min-h-11 items-center justify-center text-[15px] text-muted-foreground underline underline-offset-[3px] hover:text-foreground";

// A tour's last step: a line, its way in, then sign in and back home. Each
// tour passes its own line and buttons (ALL-71).
export function EndScreen({ line, primary, secondary }: { line: string; primary: React.ReactNode; secondary?: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[375px] flex-col gap-4 text-center">
      <p className="text-[17px]">{line}</p>
      {primary}
      {secondary}
      <Link href="/auth/login" className={END_LINK}>
        Have an invite? Sign in
      </Link>
      <Link href="/" className="inline-flex min-h-11 items-center justify-center text-[15px] font-semibold">
        Back to home
      </Link>
    </div>
  );
}
