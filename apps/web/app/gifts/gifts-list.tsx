import { GiftsInProgress } from "@/components/gifts-in-progress";
import { loadGiftsInProgress } from "@/lib/gifts-in-progress";

/** Every gift in progress, one row per round, for the gifts page. Named by the page's title. */
export async function GiftsList() {
  const gifts = await loadGiftsInProgress();
  // Reached from Give's row, so it says what happened rather than showing a blank page.
  if (gifts === null) return <p className="text-[15px] text-muted-foreground">Couldn&apos;t load your gifts. Try again.</p>;
  if (gifts.length === 0) return <p className="text-[15px] text-muted-foreground">No gifts in progress.</p>;
  return <GiftsInProgress gifts={gifts} withPerson />;
}
