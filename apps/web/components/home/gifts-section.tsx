import { GiftsInProgress } from "@/components/gifts-in-progress";
import { loadGiftsInProgress } from "@/lib/gifts-in-progress";

/** Give's gifts in progress, above the people; nothing at all when there are none. */
export async function GiftsSection() {
  const gifts = await loadGiftsInProgress();
  if (gifts.length === 0) return null;
  return (
    <section aria-labelledby="gifts-heading" className="flex flex-col gap-3">
      <h2 id="gifts-heading" className="text-[17px] font-bold">
        Gifts in progress
      </h2>
      <GiftsInProgress gifts={gifts} withPerson />
    </section>
  );
}
