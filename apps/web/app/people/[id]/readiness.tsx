import Link from "next/link";
import { ExtensionLink } from "@/components/extension-link";
import type { Readiness } from "@/modules/concierge";

// One readiness line with its meter and one next step (ALL-26, C-6). The bar is
// plain foreground ink, not teal: only the link is something to act on.
export function ReadinessBanner({ personId, name, readiness }: { personId: string; name: string; readiness: Readiness }) {
  const { score, label, step } = readiness;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border p-4" aria-label="How ready their ideas are">
      <p className="text-[15px] font-semibold">{label}</p>
      <div
        role="meter"
        aria-label={`How ready ideas for ${name} are`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-foreground" style={{ width: `${score}%` }} />
      </div>
      {step.kind === "answer" && (
        <p className="text-[15px]">
          <Link
            href={`/people/${personId}/questions`}
            className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline"
          >
            Answer {step.count} {step.count === 1 ? "question" : "questions"}
          </Link>{" "}
          to sharpen their ideas.
        </p>
      )}
      {step.kind === "capture" && (
        <p className="text-[13px] text-muted-foreground">
          <Link
            href={`/people/${personId}/know`}
            className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline"
          >
            Add something
          </Link>{" "}
          about {name}, or capture a page about them with <ExtensionLink>the extension</ExtensionLink>, to learn more.
        </p>
      )}
    </section>
  );
}
