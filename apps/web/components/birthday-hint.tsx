import Link from "next/link";

/**
 * The small note on the save-status row once Share has been used, for someone
 * with no birthday saved. The negative margin keeps its tap height out of the
 * row's, so showing it moves nothing.
 */
export function BirthdayHint() {
  return (
    <Link
      href="/settings/birthday"
      className="-my-2.5 inline-flex min-h-11 items-center whitespace-nowrap text-[13px] text-muted-foreground"
    >
      <span>
        No birthday saved. <span className="underline underline-offset-[3px]">Add it</span>
        <span className="max-sm:sr-only"> (optional)</span>
      </span>
    </Link>
  );
}
