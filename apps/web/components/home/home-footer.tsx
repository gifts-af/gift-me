import Link from "next/link";

const link = "inline-flex min-h-11 items-center underline underline-offset-[3px] hover:text-foreground";

export function HomeFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-5 px-4 py-2 text-[13px] text-muted-foreground md:px-8">
        <p className="py-3">GiftsAF alpha · made by Jim and Aaron</p>
        <div className="flex gap-x-5">
          <Link href="/feedback" className={link}>
            Feedback
          </Link>
          <Link href="/privacy" className={link}>
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  );
}
