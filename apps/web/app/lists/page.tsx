import { Suspense } from "react";
import { GiftApp, GiftAppSkeleton, getMyList } from "@/modules/lists";
import { SiteShell } from "@/components/site-shell";

// Reads the session cookie, so it has to render inside <Suspense> under
// cacheComponents.
async function ListLoader() {
  const initial = await getMyList();
  return <GiftApp initial={initial} />;
}

export default function ListsPage() {
  return (
    <SiteShell>
      <Suspense fallback={<GiftAppSkeleton />}>
        <ListLoader />
      </Suspense>
    </SiteShell>
  );
}
