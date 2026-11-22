"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { money } from "@/app/people/[id]/money";

/**
 * Going over the budget only on purpose (ALL-29 AC-6, S3): the round screen asks when a tick
 * takes the picks over, and the fix page when a replacement would. Closing it is "Keep within
 * budget". `totalCents` is everything the round would spend.
 */
export function OverBudgetSheet({
  open,
  totalCents,
  budgetCents,
  onYes,
  onKeep,
}: {
  open: boolean;
  totalCents: number;
  budgetCents: number | null;
  onYes: () => void;
  onKeep: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onKeep()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Over budget</DialogTitle>
          {budgetCents !== null && (
            <DialogDescription>{`${money(totalCents)} is ${money(totalCents - budgetCents)} over the ${money(budgetCents)} budget.`}</DialogDescription>
          )}
        </DialogHeader>
        <Button type="button" onClick={onYes}>
          Yes, pick it
        </Button>
        <Button type="button" variant="outline" onClick={onKeep}>
          Keep within budget
        </Button>
      </DialogContent>
    </Dialog>
  );
}
