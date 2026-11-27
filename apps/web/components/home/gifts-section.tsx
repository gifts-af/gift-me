import { SettingsRow } from "@/components/settings-row";
import { loadGiftsInProgress } from "@/lib/gifts-in-progress";

/**
 * Give's gifts in progress, above the people: one row with how many there are and how many need
 * you, opening the full list at /gifts. Nothing at all when there are none, or when the read
 * failed, rather than a count that could be wrong.
 */
export async function GiftsSection() {
  const gifts = await loadGiftsInProgress();
  if (!gifts || gifts.length === 0) return null;
  // "Need you" is the status line's own flag, so this count and the list's order can't disagree.
  const needYou = gifts.filter((g) => g.line.needsBuyer).length;
  const value = (
    <>
      {gifts.length}
      {needYou > 0 && (
        <>
          {" · "}
          <span className="font-semibold text-warning">{needYou === 1 ? "1 needs you" : `${needYou} need you`}</span>
        </>
      )}
    </>
  );
  return (
    <div className="divide-y divide-border rounded-xl border border-border">
      <SettingsRow href="/gifts" label="Gifts in progress" value={value} />
    </div>
  );
}
