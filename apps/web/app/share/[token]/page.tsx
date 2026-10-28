import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GiftAppSkeleton, SharedList, getSharedList } from "@/modules/lists";

// Params and the session cookie are runtime data, so the loader has to
// render inside <Suspense> under cacheComponents. Works signed out.
async function SharedListLoader({ params }: PageProps<"/share/[token]">) {
  const { token } = await params;
  const list = await getSharedList(token);
  if (!list) notFound();
  // The owner sees their list without claims (product decision 39): the
  // database leaves them out, so there's nothing to spoil and no gate.
  return <SharedList list={list} token={token} />;
}

export default function SharePage(props: PageProps<"/share/[token]">) {
  return (
    <Suspense fallback={<GiftAppSkeleton />}>
      <SharedListLoader {...props} />
    </Suspense>
  );
}
