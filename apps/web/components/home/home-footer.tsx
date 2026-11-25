import Link from "next/link";

export function HomeFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 px-4 py-2 text-[13px] text-muted-foreground md:px-8">
        <p>GiftsAF alpha · made by Jim and Aaron</p>
        <Link href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-[3px] hover:text-foreground">
          Privacy
        </Link>
      </div>
    </footer>
  );
}
