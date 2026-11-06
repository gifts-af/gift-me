import { Gift, HeartHandshake } from "lucide-react";
import Link from "next/link";

export type ProductTab = "get" | "give";

const TABS = [
  { key: "get", href: "/lists", label: "Get", Icon: Gift },
  { key: "give", href: "/", label: "Give", Icon: HeartHandshake },
] as const;

// Get (your list) and Give (your people), the same at every width (ALL-95).
// Sized to fit a 320 px screen beside the logo and the account menu.
export function ProductTabs({ current }: { current?: ProductTab }) {
  return (
    <nav aria-label="Main" className="flex text-[15px]">
      {TABS.map(({ key, href, label, Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={current === key ? "page" : undefined}
          className="inline-flex min-h-11 min-w-[68px] items-center justify-center gap-1.5 border-b-[3px] border-transparent px-2 text-muted-foreground hover:text-foreground aria-[current=page]:border-sticker aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
        >
          <Icon className="size-4 flex-none" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
