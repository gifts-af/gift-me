"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Link as LinkIcon, MessageCircle, Share } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FacebookIcon, InstagramIcon, WhatsAppIcon, XIcon } from "./share-icons";

const SHARE_TEXT = "Here's my gift list on GiftsAF:";
const POST_TEXT = "My gift list on GiftsAF";

// Every option is a full-width row with a border, so it reads as tappable, 44 px or taller.
const OPTION =
  "flex min-h-11 w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left text-base font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export type ShareMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  // Only where an image file can be shared.
  instagram: boolean;
  // Only on a touch screen: sms: links do nothing on most computers.
  messages: boolean;
  // Only where the browser has a share sheet.
  more: boolean;
  onInstagram: () => void;
  onCopy: () => void;
  onMore: () => void;
  // Any option used, links included.
  onUsed: () => void;
  // A small note under the options, such as the birthday link. Following a link in it closes the box.
  note?: ReactNode;
};

export function shareLinks(url: string) {
  const text = `${SHARE_TEXT} ${url}`;
  return {
    messages: `sms:?&body=${encodeURIComponent(text)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    x: `https://x.com/intent/post?text=${encodeURIComponent(POST_TEXT)}&url=${encodeURIComponent(url)}`,
  };
}

export default function ShareMenu(props: ShareMenuProps) {
  const { open, onOpenChange: setOpen, url, onUsed } = props;
  // Instagram gets its own step: how to add the link is said here, before Instagram opens and
  // covers the page. Its button is a second tap, so the share sheet still opens from a tap.
  const [step, setStep] = useState<"menu" | "instagram">("menu");
  function onOpenChange(next: boolean) {
    if (!next) setStep("menu");
    setOpen(next);
  }
  const links = shareLinks(url);

  function choose(action: () => void) {
    return () => {
      onOpenChange(false);
      onUsed();
      action();
    };
  }

  const web = (href: string, icon: ReactNode, name: string) => (
    <li>
      <a href={href} target="_blank" rel="noopener noreferrer" className={OPTION} onClick={choose(() => {})}>
        {icon}
        {name}
      </a>
    </li>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {step === "instagram" ? (
          <>
            <DialogHeader>
              <DialogTitle>Share to Instagram</DialogTitle>
              <DialogDescription>Your list card goes in a Story or post. Instagram can&apos;t add the link itself, so:</DialogDescription>
            </DialogHeader>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-[15px]">
              <li>
                Tap <strong>Open Instagram</strong> and pick Story. We copy your link at the same time.
              </li>
              <li>
                Add a <strong>Link</strong> sticker and paste.
              </li>
            </ol>
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button type="button" onClick={choose(props.onInstagram)}>
                <InstagramIcon />
                Open Instagram
              </Button>
              <Button type="button" variant="outline" onClick={() => setStep("menu")}>
                Back
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Share your list</DialogTitle>
              <DialogDescription>Anyone with the link can see your list.</DialogDescription>
            </DialogHeader>
            <ul className="flex flex-col gap-2">
              {props.instagram && (
                <li>
                  <button type="button" className={OPTION} onClick={() => setStep("instagram")}>
                    <InstagramIcon />
                    Instagram Story
                  </button>
                </li>
              )}
              {props.messages && (
                <li>
                  <a href={links.messages} className={OPTION} onClick={choose(() => {})}>
                    <MessageCircle className="size-5" aria-hidden="true" />
                    Messages
                  </a>
                </li>
              )}
              {web(links.whatsapp, <WhatsAppIcon />, "WhatsApp")}
              {web(links.facebook, <FacebookIcon />, "Facebook")}
              {web(links.x, <XIcon />, "X")}
              <li>
                <button type="button" className={OPTION} onClick={choose(props.onCopy)}>
                  <LinkIcon className="size-5" aria-hidden="true" />
                  Copy link
                </button>
              </li>
              {props.more && (
                <li>
                  <button type="button" className={OPTION} onClick={choose(props.onMore)}>
                    <Share className="size-5" aria-hidden="true" />
                    More…
                  </button>
                </li>
              )}
            </ul>
            {props.note && (
              // The note's link reaches 10 px past its text; the padding keeps that off the last option.
              // Only a tap on a link closes it: the strip is wider than the link, and a stray tap mustn't dismiss the box.
              <div
                className="flex justify-center pt-2.5"
                onClick={(event) => {
                  if ((event.target as Element).closest("a")) onOpenChange(false);
                }}
              >
                {props.note}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
