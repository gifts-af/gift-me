import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { readAccess } from "@/components/concierge-gate";
import { appSettingInt } from "@/lib/app-settings";
import { errorFields, logEvent } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { getSharedList } from "@/modules/lists";
import { addPersonAction, setPhotoAction } from "../actions";
import { PersonForm } from "../person-form";

// Add someone you buy for. Signed-out visitors are sent to sign in by proxy.ts.
// From a shared list's "Add … to your people" (ALL-123), `?list=<token>`
// starts the form with the owner's name and links the list on save.
export default function NewPersonPage({ searchParams }: { searchParams: Promise<{ list?: string | string[] }> }) {
  return (
    <>
      <TopBar>
        <AppNav current="give" />
      </TopBar>
      <PageFrame>
        <PageTitle>Add someone you buy for</PageTitle>
        <Suspense fallback={null}>
          <Form searchParams={searchParams} />
        </Suspense>
      </PageFrame>
    </>
  );
}

/**
 * The list behind a `?list=` token, when it's someone else's; getSharedList
 * refuses a malformed token. If the list can't be read, the plain form shows.
 */
async function fromList(list: string | string[] | undefined): Promise<{ token: string; ownerName: string } | null> {
  if (typeof list !== "string") return null;
  try {
    const shared = await getSharedList(list);
    if (!shared || shared.isOwner) return null;
    return { token: list, ownerName: shared.ownerName ?? "" };
  } catch (error) {
    unstable_rethrow(error);
    logEvent("people.share_read_failed", errorFields(error));
    return null;
  }
}

async function Form({ searchParams }: { searchParams: Promise<{ list?: string | string[] }> }) {
  const supabase = await createClient();
  const userId = (await supabase.auth.getClaims()).data?.claims?.sub;
  if (!userId) redirect("/");
  const [maxUploadBytes, px, link, access] = await Promise.all([
    appSettingInt("person_photo_max_upload_bytes"),
    appSettingInt("person_photo_px"),
    searchParams.then((p) => fromList(p.list)),
    searchParams.then((p) => (p.list ? readAccess() : null)),
  ]);
  return (
    <PersonForm
      action={addPersonAction}
      photoAction={setPhotoAction}
      userId={userId}
      maxUploadBytes={maxUploadBytes}
      px={px}
      doneHref="/give"
      initialName={link?.ownerName}
      shareToken={link?.token}
      heldGiftNotice={access?.access !== false}
    />
  );
}
