"use client";

import { RequestAccessForm } from "@/app/request-access/request-access-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CONCIERGE_REQUEST } from "@/lib/access-request-copy";

// Opens the form over the page, so asking doesn't feel like leaving for a
// separate "email me" page. It stays open after the thank-you, whose link
// starts a list.
export function RequestAccessButton({ variant }: { variant: "default" | "secondary" }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant={variant}>
          {CONCIERGE_REQUEST.title}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{CONCIERGE_REQUEST.title}</DialogTitle>
          <DialogDescription>{CONCIERGE_REQUEST.description}</DialogDescription>
        </DialogHeader>
        <RequestAccessForm />
      </DialogContent>
    </Dialog>
  );
}
