import { Suspense } from "react";
import GiftApp, { GiftAppSkeleton } from "@/components/gifts/gift-app";
import { SiteShell } from "@/components/site-shell";
import { getMyList } from "@/lib/lists";

// Reads the session cookie, so it has to render inside <Suspense> under
// cacheComponents.
async function ListLoader() {
  const initial = await getMyList();
  return <GiftApp initial={initial} />;
}

export default function Home() {
  return (
    <SiteShell>
      <Suspense fallback={<GiftAppSkeleton />}>
        <ListLoader />
      </Suspense>
    </SiteShell>
  );
}
