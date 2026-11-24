import { Button } from "@/components/ui/button";
import type { Gift } from "@/modules/lists/lib/lists";
import { storeName } from "@/modules/lists/lib/product-link";
import Modal from "./modal";

/**
 * Shown before opening an unclaimed gift's product page, as a reminder to
 * come back and claim it. The "go" choice is a real link so the new tab
 * isn't eaten by a popup blocker.
 */
export type ViewDialogProps = {
  gift: Pick<Gift, "name" | "productUrl">;
  onClose: () => void;
};

export default function ViewDialog({ gift, onClose }: ViewDialogProps) {
  return (
    <Modal labelledBy="view-dialog-title" describedBy="view-dialog-desc" onClose={onClose}>
      <h2 id="view-dialog-title" className="text-[17px] font-semibold">
        Going to buy it?
      </h2>
      <p id="view-dialog-desc" className="text-[15px] text-muted-foreground">
        If you buy {gift.name}, come back and claim it, so nobody else buys it too.
      </p>
      <Button asChild className="w-full whitespace-normal text-center">
        <a href={gift.productUrl ?? undefined} target="_blank" rel="noopener noreferrer" onClick={onClose}>
          Open on {storeName(gift.productUrl ?? "")}, and I’ll claim it if I buy it
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </Button>
      <Button type="button" variant="link" size="sm" className="px-1 self-center" onClick={onClose}>
        Cancel
      </Button>
    </Modal>
  );
}
