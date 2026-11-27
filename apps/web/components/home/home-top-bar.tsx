import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { TopBarRow } from "@/components/top-bar-row";

// The home page's own bar: the name and Sign in.
// "How it works" shows from computer width up.
export function HomeTopBar({ howItWorks = false }: { howItWorks?: boolean }) {
  return (
    <header>
      <TopBarRow>
      <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-[19px]">
        <Logo />
      </Link>
      <nav className="flex items-center gap-3 text-[14px] font-semibold sm:gap-5">
        {howItWorks && (
          <a
            href="#how-it-works"
            className="hidden min-h-11 items-center text-muted-foreground hover:text-foreground md:inline-flex"
          >
            How it works
          </a>
        )}
        <Link href="/auth/login" className="inline-flex min-h-11 items-center text-primary">
          Sign in
        </Link>
        <ThemeToggle />
      </nav>
      </TopBarRow>
    </header>
  );
}
