import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SKIP_KEY = "giftsaf:skip-name-prompt";

export type SaveNameResult = { ok: true } | { ok: false; error: string };

export type NamePromptProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saveName: (name: string) => Promise<SaveNameResult>;
  // Resolves true once the link is on the clipboard.
  copyLink: () => Promise<boolean>;
  onNamed: () => void;
  onCopied?: () => void;
};

// Skip is remembered on this device only, and storage can be missing or
// blocked (private windows): then the prompt simply asks again next time.
export function skippedNamePrompt() {
  try {
    return localStorage.getItem(SKIP_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberSkip() {
  try {
    localStorage.setItem(SKIP_KEY, "1");
  } catch {
    // Nothing to do: it asks again next time.
  }
}

/**
 * Asks someone with no display name what their shared list should say, the
 * first time they share it (ALL-136). The field starts empty: the name is only
 * ever what they type (T42). Both buttons copy the link, from the click itself
 * so the clipboard still allows it; "Save" also saves the name.
 */
export default function NamePrompt({ open, onOpenChange, saveName, copyLink, onNamed, onCopied }: NamePromptProps) {
  const id = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const value = name.trim();
    if (!value) {
      setError("Type a name, or tap Skip.");
      return;
    }
    setBusy(true);
    setError(null);
    const copied = copyLink();
    let result: SaveNameResult;
    try {
      result = await saveName(value);
    } catch {
      result = { ok: false, error: "Your name couldn't be saved. Try again." };
    }
    if (await copied) onCopied?.();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onNamed();
    onOpenChange(false);
  }

  function skip() {
    rememberSkip();
    void copyLink().then((ok) => ok && onCopied?.());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>What name should your list show?</DialogTitle>
          <DialogDescription>People you share with see it at the top of your list.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id}>Your name</Label>
            <Input
              id={id}
              value={name}
              maxLength={80}
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </div>
          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button type="submit" disabled={busy}>
              Save and copy link
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={skip}>
              Skip
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
