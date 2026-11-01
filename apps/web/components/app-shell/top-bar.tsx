import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { TopBarRow } from "@/components/top-bar-row";

type Current = "list" | "people";

// The bar on every app screen (mock-ups "home", "home-wide", "list"). On a
// phone: the name or a back link, then actions and the account menu. From
// 640 px the product links sit beside the name.
export function TopBar({
  back,
  links = false,
  current,
  actions,
  account,
}: {
  back?: { href: string; label: string };
  links?: boolean;
  current?: Current;
  actions?: React.ReactNode;
  account?: React.ReactNode;
}) {
  return (
    <header className="border-b">
      <TopBarRow>
        <div className="flex min-w-0 items-center gap-8">
          {back ? (
            <>
              <Link
                href={back.href}
                className={cn("-ml-1 inline-flex min-h-11 items-center gap-0.5 pr-2 text-[15px]", links && "sm:hidden")}
              >
                <ChevronLeft className="size-5" aria-hidden="true" />
                {back.label}
              </Link>
              {links && <Brand className="hidden sm:inline-flex" />}
            </>
          ) : (
            <Brand />
          )}
          {links && <ProductLinks current={current} />}
        </div>
        <div className="flex items-center gap-1">
          {actions}
          {account}
        </div>
      </TopBarRow>
    </header>
  );
}

function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("inline-flex min-h-11 items-center text-[19px]", className)}>
      <Logo />
    </Link>
  );
}

function ProductLinks({ current }: { current?: Current }) {
  const items: { href: string; label: string; key: Current }[] = [
    { href: "/lists", label: "My list", key: "list" },
    { href: "/", label: "People", key: "people" },
  ];
  return (
    <nav aria-label="Main" className="hidden gap-5 text-[15px] sm:flex">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={current === item.key ? "page" : undefined}
          className="inline-flex min-h-11 items-center text-muted-foreground hover:text-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
