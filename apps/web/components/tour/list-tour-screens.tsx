import { Phone } from "./phone";
import { MY_LIST } from "./tour-data";

// The list tour's phone screens (ALL-71). Made-up gifts from the concierge
// tour's "My list" step; nothing is saved or sent.

const NOTES: Record<string, string> = {
  "Pour-over coffee kettle": "From a kitchen shop · gooseneck, please",
  "Paperback: a mystery novel": "Any bookshop · something new to me",
  "Rain jacket, size M": "From an outdoor shop · size M, any dark color",
};

function Thumb({ gift }: { gift: (typeof MY_LIST)[number] }) {
  return (
    <span data-testid="gift-thumb" className="grid size-10 flex-none place-items-center rounded-md bg-muted text-primary" aria-hidden="true">
      <gift.icon className="size-5" />
    </span>
  );
}

// Your list, as you see it: no claim marks, ever (decision 39).
export function MyListScreen({ withNotes = false }: { withNotes?: boolean }) {
  return (
    <Phone title="My list">
      {MY_LIST.map((gift) => (
        <div key={gift.name} className="flex items-center gap-3 rounded-lg border p-3">
          <Thumb gift={gift} />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold">{gift.name}</span>
            {withNotes && <span className="block text-[12px] text-muted-foreground">{NOTES[gift.name]}</span>}
          </span>
          <span className="text-[14px] font-semibold tabular-nums">{gift.price}</span>
        </div>
      ))}
      <span className="self-start rounded-lg bg-secondary px-4 py-2.5 text-[15px] font-semibold text-secondary-foreground">+ Add a gift</span>
    </Phone>
  );
}

export function ShareScreen() {
  return (
    <Phone title="Messages · Mom">
      <div className="flex flex-col gap-2 text-[15px]">
        <span className="max-w-[80%] self-start rounded-2xl bg-muted px-3 py-2">what do u want for ur bday?</span>
        <span className="max-w-[80%] self-end rounded-2xl bg-primary px-3 py-2 text-primary-foreground">
          here you go 👇
          <span className="mt-1 block rounded-lg bg-card px-2 py-1.5 text-[13px] text-card-foreground">🎁 My list · giftsaf.com/share/…</span>
        </span>
      </div>
      {/* In the tour it does nothing: there's no real link to copy. */}
      <button type="button" className="min-h-11 self-start rounded-lg bg-secondary px-4 text-[15px] font-semibold text-secondary-foreground">
        Copy link
      </button>
    </Phone>
  );
}

// The shared list as Mom sees it: she can claim, and sees what's taken.
export function ClaimScreen({ claimed, onClaim }: { claimed: string[]; onClaim: (name: string) => void }) {
  return (
    <Phone title="Your list, as Mom sees it">
      {MY_LIST.map((gift) => (
        <div key={gift.name} className="flex items-center gap-3 rounded-lg border p-3">
          <Thumb gift={gift} />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold">{gift.name}</span>
            <span className="block text-[12px] tabular-nums text-muted-foreground">{gift.price}</span>
          </span>
          {claimed.includes(gift.name) ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[12px] font-semibold text-muted-foreground">Claimed</span>
          ) : (
            <button
              type="button"
              aria-label={`Claim ${gift.name}`}
              onClick={() => onClaim(gift.name)}
              className="min-h-11 rounded-lg bg-primary px-3 text-[14px] font-bold text-primary-foreground hover:bg-primary/90"
            >
              Claim
            </button>
          )}
        </div>
      ))}
    </Phone>
  );
}
