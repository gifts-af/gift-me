import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { TopBarRow } from "@/components/top-bar-row";

// The bar on every app screen: the logo, then a slot. Signed in, the slot
// holds Get, Give and the account menu (AppNav). With nothing in it, it holds
// the sun/moon, for signed-out visitors and shared lists (ALL-74, ALL-95).
export function TopBar({ children }: { children?: React.ReactNode }) {
  return (
    <header className="border-b">
      <TopBarRow>
        <Link href="/" className="inline-flex min-h-11 flex-none items-center text-[19px]">
          <Logo />
        </Link>
        <div className="flex min-w-0 flex-1 items-center">
          {children ?? (
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          )}
        </div>
      </TopBarRow>
    </header>
  );
}
