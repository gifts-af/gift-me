import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { appSettingInt } from "@/lib/app-settings";
import { createClient } from "@/lib/supabase/server";
import { addPersonAction, setPhotoAction } from "../actions";
import { PersonForm } from "../person-form";

// Add someone you buy for. Signed-out visitors are sent to sign in by proxy.ts.
export default function NewPersonPage() {
  return (
    <>
      <TopBar>
        <AppNav current="give" />
      </TopBar>
      <PageFrame>
        <PageTitle>Add someone you buy for</PageTitle>
        <Suspense fallback={null}>
          <Form />
        </Suspense>
      </PageFrame>
    </>
  );
}

async function Form() {
  const supabase = await createClient();
  const userId = (await supabase.auth.getClaims()).data?.claims?.sub;
  if (!userId) redirect("/");
  const [maxUploadBytes, px] = await Promise.all([
    appSettingInt("person_photo_max_upload_bytes"),
    appSettingInt("person_photo_px"),
  ]);
  return (
    <PersonForm
      action={addPersonAction}
      photoAction={setPhotoAction}
      userId={userId}
      maxUploadBytes={maxUploadBytes}
      px={px}
      doneHref="/"
    />
  );
}
