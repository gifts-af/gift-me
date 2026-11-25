import Link from "next/link";
import { Check } from "lucide-react";
import { requestAccessAction } from "@/app/give/actions";
import { RequestAccess } from "@/app/give/request-access";
import { Button } from "@/components/ui/button";

const POINTS = [
  { title: "Never miss a date", text: "A heads-up early enough to arrive on time." },
  { title: "Ideas that fit them", text: "A short list, inside your budget." },
  { title: "One tap, shipped", text: "Nothing is bought without your yes." },
];

// What someone without the concierge sees in its place: what it does and a way
// to ask for it, or, once they've asked, that the request was sent.
export function ConciergePitch({ requested }: { requested: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <RequestAccess
        action={requestAccessAction}
        requested={requested}
        ask={
          <>
            <div className="flex flex-col gap-3">
              <h1 className="text-[28px] font-extrabold leading-[1.1] tracking-tight">Gifting, handled AF.</h1>
              <p className="text-[16px] text-muted-foreground">
                The concierge remembers the dates, finds gifts they&apos;ll love, and ships them. You just tap yes.
              </p>
            </div>
            <ul className="flex flex-col gap-4">
              {POINTS.map((point) => (
                <li key={point.title}>
                  <span className="block text-[16px] font-bold">{point.title}</span>
                  <span className="block text-[15px] text-muted-foreground">{point.text}</span>
                </li>
              ))}
            </ul>
          </>
        }
        sent={
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <h1 className="text-[28px] font-extrabold leading-[1.1] tracking-tight">You asked for access</h1>
              <p className="inline-flex items-center gap-2 text-[16px] font-bold text-primary">
                <Check aria-hidden="true" className="size-5 flex-none" />
                Request sent
              </p>
              <p className="text-[16px] text-muted-foreground">
                We&apos;re letting people in a few at a time. We&apos;ll email you when you&apos;re in.
              </p>
              <p className="text-[16px] text-muted-foreground">Your list is ready to share in the meantime.</p>
            </div>
            <Button asChild>
              <Link href="/lists">Go to my list</Link>
            </Button>
          </div>
        }
      />
      <Button asChild variant="outline">
        <Link href="/tour">Take the tour</Link>
      </Button>
    </div>
  );
}
