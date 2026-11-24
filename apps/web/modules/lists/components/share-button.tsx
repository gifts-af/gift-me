import { Button, buttonVariants } from "@/components/ui/button";
import { Share } from "lucide-react";
import { useEffect, useState } from "react";
import { BlockedButton } from "./ui";

const COPIED_MS = 2000;

type ShareButtonProps = {
  // Why Share can't be used yet; null when it can.
  blockedReason: string | null;
  // Resolves true once the link is on the clipboard.
  onShare: () => Promise<boolean>;
  // Bumped each time the link was copied elsewhere.
  copiedSignal?: number;
};

export default function ShareButton({ blockedReason, onShare, copiedSignal = 0 }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  // The name prompt copies the link itself (ALL-136): show "Copied!" for that too.
  useEffect(() => {
    if (copiedSignal > 0) setCopied(true);
  }, [copiedSignal]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const label = (
    <>
      <Share className="size-4" aria-hidden="true" />
      {copied ? "Copied!" : "Share"}
    </>
  );

  if (blockedReason) {
    return (
      <BlockedButton id="share-tooltip" reason={blockedReason} className={buttonVariants({ variant: "secondary", size: "sm" })}>
        {label}
      </BlockedButton>
    );
  }

  async function handleClick() {
    if (await onShare()) setCopied(true);
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={handleClick}>
      {label}
    </Button>
  );
}
