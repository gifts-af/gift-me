import { feedbackHref } from "@/lib/brand";

export function Feedback() {
  return (
    <section aria-labelledby="feedback-heading" className="border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-10 md:px-8">
        <h2 id="feedback-heading" className="text-[22px] font-extrabold tracking-tight">
          Found something broken? Tell us.
        </h2>
        <p className="text-[15px] text-muted-foreground">It&apos;s two of us building this. Every bit of feedback helps.</p>
        <a
          href={feedbackHref()}
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-secondary px-6 font-bold text-secondary-foreground hover:bg-secondary/70 md:self-start"
        >
          Send feedback
        </a>
      </div>
    </section>
  );
}
