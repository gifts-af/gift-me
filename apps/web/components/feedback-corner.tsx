import { FeedbackButton } from "@/components/home/feedback-dialog";

// A quiet "Feedback" link pinned to the bottom-left corner on a wide screen, on
// every page, so feedback is one click away inside the app too. Below 1280 px it
// would sit over the content column (the lists Undo bar, footers), so it hides.
export function FeedbackCorner() {
  return (
    <div className="fixed bottom-4 left-4 z-40 hidden xl:block print:hidden">
      <FeedbackButton
        variant="ghost"
        size="sm"
        label="Feedback"
        className="min-h-9 px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground"
      />
    </div>
  );
}
