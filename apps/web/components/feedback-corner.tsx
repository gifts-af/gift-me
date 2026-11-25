import { FeedbackButton } from "@/components/home/feedback-dialog";

// A quiet "Feedback" link pinned to the bottom-left corner on a computer, on
// every page, so feedback is one click away inside the app too. Phones skip it:
// a fixed corner button would sit over the content there.
export function FeedbackCorner() {
  return (
    <div className="fixed bottom-4 left-4 z-40 hidden md:block print:hidden">
      <FeedbackButton
        variant="ghost"
        size="sm"
        label="Feedback"
        className="min-h-9 px-3 text-[13px] font-medium text-muted-foreground opacity-70 hover:text-foreground hover:opacity-100 focus-visible:opacity-100"
      />
    </div>
  );
}
