import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { ConciergeGate } from "@/components/concierge-gate";
import { PersonAvatar } from "@/components/person-avatar";
import { appSettingInt } from "@/lib/app-settings";
import { createClient } from "@/lib/supabase/server";
import { todayForRequest } from "@/lib/today";
import { getPerson } from "@/modules/concierge";
import {
  removeDatedOccasionAction,
  renamePersonAction,
  setBirthYearAction,
  setDatedOccasionAction,
  setPhotoAction,
  setRelationshipAction,
} from "../../actions";
import { PhotoPicker } from "../../photo-picker";
import { AboutForm } from "./about-form";

// About a person (ALL-127, T71): photo, name, who they are to you and their
// dates, each saving on its own. Opened from the About row on their page and
// from Home's "Add birthday". Signed-out visitors are sent to sign in by proxy.ts.
export default function AboutPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <TopBar>
        <AppNav current="give" />
      </TopBar>
      <PageFrame>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading…</p>}>
          <ConciergeGate>
            <Loaded params={params} />
          </ConciergeGate>
        </Suspense>
      </PageFrame>
    </>
  );
}

const ACTIONS = {
  rename: renamePersonAction,
  setRelationship: setRelationshipAction,
  setDate: setDatedOccasionAction,
  setBirthYear: setBirthYearAction,
  removeDate: removeDatedOccasionAction,
};

async function Loaded({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const userId = (await supabase.auth.getClaims()).data?.claims?.sub;
  if (!userId) redirect("/");
  const person = await getPerson(id, await todayForRequest());
  if (!person) notFound();
  const [maxUploadBytes, px] = await Promise.all([
    appSettingInt("person_photo_max_upload_bytes"),
    appSettingInt("person_photo_px"),
  ]);

  return (
    <>
      <BackLink href={`/people/${person.id}`} label={person.name} />
      <PageTitle>About {person.name}</PageTitle>
      <div className="flex items-center gap-4">
        <PersonAvatar name={person.name} photoUrl={person.photoUrl} size={72} decorative />
        <div className="min-w-0 flex-1">
          <PhotoPicker
            personId={person.id}
            userId={userId}
            currentPath={person.photoPath}
            maxUploadBytes={maxUploadBytes}
            px={px}
            action={setPhotoAction}
          />
        </div>
      </div>
      <AboutForm
        personId={person.id}
        name={person.name}
        relationship={person.relationship}
        birthday={person.birthday}
        birthYear={person.birthYear}
        anniversary={person.anniversary}
        actions={ACTIONS}
      />
    </>
  );
}
