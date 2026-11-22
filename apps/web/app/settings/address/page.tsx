import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { getMyAddress, type MyAddress } from "@/lib/account-address";
import { roundReturnPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import { getMyList } from "@/modules/lists";
import { removeMyAddressAction, saveMyAddressAction } from "../address-actions";
import { MyAddressSection } from "../my-address";

async function LoadedAddress({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // From a gift's "Ship it to me" (ALL-29): the buyer is using a feature that needs it now.
  const next = roundReturnPath((await searchParams).next);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  const [myList, address] = await Promise.all([
    getMyList(),
    userId ? getMyAddress(supabase, userId) : Promise.resolve<MyAddress>({ kind: "unavailable" }),
  ]);
  // The same rule as the Settings list: no address row until you have a list (principle 10).
  // Except when a gift's "Ship it to me" sent the buyer here (`next`): the feature they're using
  // right now needs it, so the form shows even with no list.
  const showAddress = next !== undefined || address.kind !== "none" || myList?.list != null || myList?.loadError != null;
  if (!showAddress) redirect("/settings");
  return <MyAddressSection address={address} saveAction={saveMyAddressAction} removeAction={removeMyAddressAction} next={next} />;
}

export default function AddressPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return (
    <>
      <TopBar>
        <AppNav />
      </TopBar>
      <PageFrame>
        <BackLink href="/settings" label="Settings" />
        <PageTitle>My address</PageTitle>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading…</p>}>
          <LoadedAddress searchParams={searchParams} />
        </Suspense>
      </PageFrame>
    </>
  );
}
