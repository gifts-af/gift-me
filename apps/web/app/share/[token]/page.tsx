import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GiftAppSkeleton } from "@/components/gifts/gift-app";
import OwnerGate from "@/components/gifts/owner-gate";
import SharedList from "@/components/gifts/shared-list";
import { SiteShell } from "@/components/site-shell";
import { getSharedList } from "@/lib/lists";

// Params, search params and the session cookie are all runtime data, so the
// loader has to render inside <Suspense> under cacheComponents.
async function SharedListLoader({
  params,
  searchParams,
}: PageProps<"/share/[token]">) {
  const { token } = await params;
  const { as } = await searchParams;

  const list = await getSharedList(token);
  if (!list) notFound();

  // The owner has to opt in: once gifts can be claimed, this view shows them.
  if (list.isOwner && as !== "guest") {
    return <OwnerGate proceedHref={`/share/${encodeURIComponent(token)}?as=guest`} />;
  }

  return <SharedList list={list} />;
}

export default function SharePage(props: PageProps<"/share/[token]">) {
  return (
    <SiteShell>
      <Suspense fallback={<GiftAppSkeleton />}>
        <SharedListLoader {...props} />
      </Suspense>
    </SiteShell>
  );
}
