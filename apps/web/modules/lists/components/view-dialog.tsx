import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { SharedSize } from "@/lib/size-kinds";
import type { Gift } from "@/modules/lists/lib/lists";
import { storeName } from "@/modules/lists/lib/product-link";
import Modal from "./modal";
import SizesPanel from "./sizes-panel";

/**
 * Shown before opening an unclaimed gift's product page, as a reminder to
 * come back and claim it. The "go" choice is a real link so the new tab
 * isn't eaten by a popup blocker.
 */
export type ViewDialogProps = {
  gift: Pick<Gift, "name" | "productUrl">;
  // The owner's shared sizes, null until they've loaded or when the read failed.
  sizes?: SharedSize[] | null;
  ownerName?: string | null;
  onClose: () => void;
};

export default function ViewDialog({ gift, sizes = null, ownerName = null, onClose }: ViewDialogProps) {
  // Taken when the box opens: sizes landing later must not push the buttons down under a thumb.
  const [opened] = useState(sizes);
  return (
    <Modal labelledBy="view-dialog-title" describedBy="view-dialog-desc" onClose={onClose}>
      <h2 id="view-dialog-title" className="text-[17px] font-semibold">
        Going to buy it?
      </h2>
      <p id="view-dialog-desc" className="text-[15px] text-muted-foreground">
        If you buy {gift.name}, come back and claim it, so nobody else buys it too.
      </p>
      <SizesPanel sizes={opened} name={ownerName} giftName={gift.name} />
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
