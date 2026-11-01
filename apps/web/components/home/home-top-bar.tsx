import Link from "next/link";
import { Logo } from "@/components/logo";
import { TopBarRow } from "@/components/top-bar-row";

// The home page's own bar: the name with an ALPHA tag, and the invite-only
// way in. "How it works" shows from computer width up.
export function HomeTopBar({ howItWorks = false }: { howItWorks?: boolean }) {
  return (
    <header>
      <TopBarRow>
      <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-[19px]">
        <Logo />
        <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-foreground">
          ALPHA
        </span>
      </Link>
      <nav className="flex items-center gap-5 text-[14px] font-semibold">
        {howItWorks && (
          <a
            href="#how-it-works"
            className="hidden min-h-11 items-center text-muted-foreground hover:text-foreground md:inline-flex"
          >
            How it works
          </a>
        )}
        <Link href="/auth/login" className="inline-flex min-h-11 items-center text-primary">
          🔒 Invite only
        </Link>
      </nav>
      </TopBarRow>
    </header>
  );
}
