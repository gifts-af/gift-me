"use client";

import { FeedbackForm } from "@/app/feedback/feedback-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  useSelfClosingDialog,
} from "@/components/ui/dialog";

// "Send feedback" opens a "sad story" box over the page that emails us
// directly, instead of opening the visitor's email app.
export function FeedbackButton({ className }: { className?: string }) {
  const { open, onOpenChange, closeSoon } = useSelfClosingDialog();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" className={className}>
          Send feedback
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tell us the sad story</DialogTitle>
          <DialogDescription>What broke, or what bugged you? It goes straight to Jim and Aaron.</DialogDescription>
        </DialogHeader>
        <FeedbackForm onSent={closeSoon} sentNote="It's in our inbox. This closes itself in a few seconds." />
      </DialogContent>
    </Dialog>
  );
}
