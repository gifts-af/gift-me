"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * After an address form saves with `?next=` (ALL-29: a gift's confirm or fix page sent the
 * buyer here), goes back there. `to` is already checked as a same-site path (safeNext).
 * Shown only then, so the forms need no router otherwise.
 */
export function ReturnTo({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => router.replace(to), [router, to]);
  return (
    <p role="status" className="text-[13px] text-muted-foreground">
      Saved.{" "}
      <Link href={to} className="inline-flex min-h-11 items-center text-primary underline underline-offset-[3px]">
        Back to the gift
      </Link>
    </p>
  );
}
