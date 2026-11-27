import { GiftsInProgress } from "@/components/gifts-in-progress";
import { loadGiftsInProgress } from "@/lib/gifts-in-progress";

/** Every gift in progress, one row per round, for the gifts page. */
export async function GiftsList() {
  const gifts = await loadGiftsInProgress();
  // Reached from Give's row, so with none (or none readable) it says so rather than showing a blank page.
  if (gifts.length === 0) return <p className="text-[15px] text-muted-foreground">No gifts in progress.</p>;
  return (
    <section aria-label="Gifts in progress">
      <GiftsInProgress gifts={gifts} withPerson />
    </section>
  );
}
