import { GiftsInProgress } from "@/components/gifts-in-progress";
import { loadGiftsInProgress } from "@/lib/gifts-in-progress";

/** One person's gifts in progress, on its own so the rest of their page never waits for it. */
export async function PersonGifts({ personId }: { personId: string }) {
  const gifts = await loadGiftsInProgress(personId);
  // Extra on their page: nothing at all with none, or when the read failed.
  if (!gifts || gifts.length === 0) return null;
  return (
    <section aria-label="Gifts in progress">
      <GiftsInProgress gifts={gifts} withPerson={false} />
    </section>
  );
}
