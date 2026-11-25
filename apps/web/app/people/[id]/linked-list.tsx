"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ListPhoto } from "@/modules/lists";

const TILTS = ["-rotate-6", "rotate-3", "-rotate-2"];

/** The card at the top of a linked person's page: opens their list, with a few of its gifts' photos. */
export function LinkedList({ name, href, photos }: { name: string; href: string; photos: ListPhoto[] }) {
  const [failed, setFailed] = useState<string[]>([]);
  const hide = (url: string) => setFailed((urls) => (urls.includes(url) ? urls : [...urls, url]));
  const shown = photos.filter(({ url }) => !failed.includes(url));
  // Amazon answers with a 1x1 image when it has no photo. The check on mount is for one that
  // loaded or failed before the page was ready to hear about it.
  const blank = (img: HTMLImageElement) => img.complete && img.naturalWidth <= 1;

  return (
    <section
      aria-labelledby="linked-list-heading"
      className="relative flex flex-wrap items-center justify-between gap-x-2 gap-y-4 rounded-xl border border-border bg-card p-4"
    >
      {/* Wide enough for the button; where the photos don't fit beside that, they go underneath. */}
      <div className="flex min-w-0 flex-1 basis-[120px] flex-col gap-2.5">
        <h2 id="linked-list-heading" className="text-lg font-semibold [overflow-wrap:anywhere]">
          {name}&apos;s GiftsAF list
        </h2>
        <Button asChild size="sm" className="self-start">
          {/* The link covers the whole card; the photos sit above it, each opening the list at its own gift. */}
          <Link href={href} className="after:absolute after:inset-0 after:rounded-xl">
            See their list
          </Link>
        </Button>
      </div>
      {shown.length > 0 && (
        <div className="relative z-10 flex shrink-0 -space-x-4">
          {shown.map(({ giftId, name: gift, url }, i) => (
            <Link key={url} href={`${href}#gift-${giftId}`} className={`rounded-lg ${TILTS[i]}`}>
              {/* A plain <img>: next/image would fetch it through our server. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`See ${gift} on their list`}
                referrerPolicy="no-referrer"
                ref={(img) => {
                  if (img && blank(img)) hide(url);
                }}
                onLoad={(e) => blank(e.currentTarget) && hide(url)}
                onError={() => hide(url)}
                className="size-16 rounded-lg border border-border bg-white object-contain p-1"
              />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
