import { Suspense } from "react";
import { GiftApp, GiftAppSkeleton, getMyList } from "@/modules/lists";

// Reads the session cookie, so it has to render inside <Suspense> under
// cacheComponents. Works signed in or out; a guest's list isn't saved.
async function ListLoader() {
  const initial = await getMyList();
  return <GiftApp initial={initial} />;
}

export default function ListsPage() {
  return (
    <Suspense fallback={<GiftAppSkeleton />}>
      <ListLoader />
    </Suspense>
  );
}
