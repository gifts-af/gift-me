import { Gift } from "lucide-react";
import { cn } from "@/lib/utils";

// A gift idea's product photo (ALL-29 AC-17), or the gift icon when there isn't one. Photos come
// only from Zinc and are https only. No referrer is sent, so the store never learns which page
// (and which round) showed its picture.
export function IdeaPhoto({ url, title, className }: { url: string | null; title: string; className?: string }) {
  const box = cn("size-14 flex-none overflow-hidden rounded-lg border border-border bg-muted", className);
  if (url) {
    // A plain <img>: next/image would fetch it through our server, which the store would see.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={title} referrerPolicy="no-referrer" loading="lazy" className={cn(box, "object-contain bg-white")} />;
  }
  return (
    <span role="img" aria-label={title} className={cn(box, "flex items-center justify-center text-muted-foreground")}>
      <Gift className="size-6" aria-hidden />
    </span>
  );
}
