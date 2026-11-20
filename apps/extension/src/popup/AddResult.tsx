import { config } from "../lib/config";
import type { AddOutcome } from "../lib/upload";
import { formatPrice } from "./ProductCard";
import { SuccessBanner } from "./SuccessBanner";

// What happened after "Add to my list" (AC-6 to AC-8b): added, already there,
// a likely duplicate to confirm, or a full list.
export function AddResult({
  result,
  gift,
  busy,
  onAddAnyway,
  onDontAdd,
  onDone,
}: {
  result: AddOutcome;
  /** The name and price that were sent. */
  gift: { name: string; priceCents: number };
  busy: boolean;
  onAddAnyway: () => void;
  onDontAdd: () => void;
  onDone: () => void;
}) {
  if (result.outcome === "likely") {
    const { existing } = result;
    return (
      <div className="flex flex-col gap-3.5 p-4">
        <p className="m-0 text-[15px] font-semibold">This looks like a gift already on your list</p>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-10 w-10 flex-none place-items-center overflow-hidden rounded-md bg-muted">
            {existing.imageUrl && <img className="h-full w-full object-cover" src={existing.imageUrl} alt={existing.name} />}
          </span>
          <span className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">
            <span className="block">{existing.name}</span>
            <small className="block text-xs font-normal text-muted-foreground">{formatPrice(existing.priceCents)}</small>
          </span>
        </div>
        <div className="flex gap-2.5">
          <button className="btn-primary flex-1" type="button" disabled={busy} aria-busy={busy} onClick={onAddAnyway}>
            {busy ? "Adding…" : "Add anyway"}
          </button>
          <button className="btn-outline flex-1" type="button" disabled={busy} onClick={onDontAdd}>
            Don't add
          </button>
        </div>
      </div>
    );
  }

  const detail = `${gift.name} · ${formatPrice(gift.priceCents)}`;
  return (
    <div className="flex flex-col gap-3.5 p-4">
      {result.outcome === "added" && (
        <>
          <SuccessBanner title="Added to your list" detail={detail} />
          <p className="m-0 text-sm">People who have your list link can see it now.</p>
        </>
      )}
      {result.outcome === "duplicate" && (
        <>
          <SuccessBanner title="Already on your list" detail={detail} />
          <p className="m-0 text-sm">This link is on your list already, so nothing was added twice.</p>
        </>
      )}
      {result.outcome === "full" && (
        <p role="alert" className="note">
          <b>Your list is full</b>
          Remove a gift from it to add this one.
        </p>
      )}
      <div className="flex gap-2.5">
        <a className="btn-primary flex-1" href={`${config.appOrigin}/lists`} target="_blank" rel="noreferrer">
          See your list
        </a>
        <button className="btn-outline flex-1" type="button" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
