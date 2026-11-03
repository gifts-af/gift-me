import { ListChecks, Sparkles } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { relationshipLabel } from "@gifts-af/core";
import { OCCASION_NAMES, shortDate } from "@/components/occasion-format";
import { PersonAvatar } from "@/components/person-avatar";
import { PageTitle } from "@/components/app-shell/page-frame";
import { appSettingInt } from "@/lib/app-settings";
import { createClient } from "@/lib/supabase/server";
import { todayForRequest } from "@/lib/today";
import { getPerson, getWhatWeKnow } from "@/modules/concierge";
import {
  deletePersonAction,
  linkListAction,
  readCapturesAction,
  removeAddressAction,
  removeFactAction,
  saveAddressAction,
  setBudgetAction,
  setOccasionEnabledAction,
  setPhotoAction,
  unlinkListAction,
  updatePersonAction,
} from "../actions";
import { PersonForm } from "../person-form";
import { PhotoPicker } from "../photo-picker";
import { AddressSection } from "./address";
import { Budgets } from "./budgets";
import { DeletePerson } from "./delete-person";
import { ListLink } from "./list-link";
import { Occasions } from "./occasions";
import { WhatWeKnow } from "./what-we-know";

const text = (n: number | undefined) => (n === undefined ? "" : String(n));

/**
 * Everything about one person, top to bottom as in the mock-up. An unknown,
 * deleted or someone else's id is a 404. Room for the ALL-25 and ALL-26
 * sections goes between the list line and Edit.
 */
export async function PersonView({
  id,
  photoFailed,
  openAddress,
}: {
  id: string;
  photoFailed: boolean;
  /** From `?address=open`, the "Add an address" email's link (ALL-81). */
  openAddress: boolean;
}) {
  const supabase = await createClient();
  const userId = (await supabase.auth.getClaims()).data?.claims?.sub;
  if (!userId) redirect("/");
  const person = await getPerson(id, await todayForRequest());
  if (!person) notFound();
  const [maxUploadBytes, px, knowledge] = await Promise.all([
    appSettingInt("person_photo_max_upload_bytes"),
    appSettingInt("person_photo_px"),
    getWhatWeKnow(person.id),
  ]);

  return (
    <>
      <header className="flex items-center gap-4">
        <PersonAvatar name={person.name} photoUrl={person.photoUrl} size={72} decorative />
        <div className="min-w-0 flex-1">
          <PageTitle>{person.name}</PageTitle>
          <p className="text-[13px] text-muted-foreground">
            {relationshipLabel(person.relationship)}
            {person.next && ` · ${OCCASION_NAMES[person.next.kind]}, ${shortDate(person.next.date)}`}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
            {person.keepsList ? (
              <ListChecks className="size-3.5" aria-hidden="true" />
            ) : (
              <Sparkles className="size-3.5" aria-hidden="true" />
            )}
            {person.keepsList ? "Their own list" : "No list of their own, so we suggest ideas"}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-1.5">
        <PhotoPicker
          personId={person.id}
          userId={userId}
          currentPath={person.photoPath}
          maxUploadBytes={maxUploadBytes}
          px={px}
          action={setPhotoAction}
        />
        {photoFailed && (
          <p role="status" className="text-[13px] text-muted-foreground">
            The photo didn&apos;t save. Try again.
          </p>
        )}
      </div>

      <WhatWeKnow
        personId={person.id}
        name={person.name}
        knowledge={knowledge}
        removeAction={removeFactAction}
        readAction={readCapturesAction}
      />

      <section className="flex flex-col gap-3 border-b border-border pb-6" aria-labelledby="edit-heading">
        <h2 id="edit-heading" className="text-lg font-semibold">
          Edit
        </h2>
        <PersonForm
          mode="edit"
          action={updatePersonAction}
          initial={{
            id: person.id,
            name: person.name,
            relationship: person.relationship,
            birthdayMonth: text(person.birthday?.month),
            birthdayDay: text(person.birthday?.day),
            birthYear: text(person.birthYear ?? undefined),
            anniversaryMonth: text(person.anniversary?.month),
            anniversaryDay: text(person.anniversary?.day),
          }}
        />
      </section>

      <Occasions personId={person.id} occasions={person.occasions} action={setOccasionEnabledAction} />
      <Budgets personId={person.id} occasions={person.occasions} action={setBudgetAction} />
      <AddressSection
        personId={person.id}
        name={person.name}
        address={person.address}
        startOpen={openAddress}
        saveAction={saveAddressAction}
        removeAction={removeAddressAction}
      />
      <ListLink
        personId={person.id}
        keepsList={person.keepsList}
        linkAction={linkListAction}
        unlinkAction={unlinkListAction}
      />
      <DeletePerson personId={person.id} name={person.name} action={deletePersonAction} />
    </>
  );
}
