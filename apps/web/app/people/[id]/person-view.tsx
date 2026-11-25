import { ListChecks } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { relationshipLabel } from "@gifts-af/core";
import { OCCASION_NAMES, monthDay, shortDate } from "@/lib/occasion-format";
import { PersonAvatar } from "@/components/person-avatar";
import { PageTitle } from "@/components/app-shell/page-frame";
import { readAccess } from "@/components/concierge-gate";
import { appSettingInt } from "@/lib/app-settings";
import { createClient } from "@/lib/supabase/server";
import { todayForRequest } from "@/lib/today";
import { getPerson, countSavedGifts, getProfile, hasPastGifts, onDemandIdeas, type Db, type PersonDetail } from "@/modules/concierge";
import { getPersonListPhotos, getPersonShareToken } from "@/modules/lists";
import { SettingsRow } from "@/components/settings-row";
import {
  deleteFactAction,
  deletePersonAction,
  editFactAction,
  linkUnlinkedListAction,
  readCapturesAction,
  setFactActiveAction,
  setOccasionEnabledAction,
} from "../actions";
import { BudgetRow } from "./budget-row";
import { DeletePerson } from "./delete-person";
import { LinkedList } from "./linked-list";
import { ListLink } from "./list-link";
import { Occasions } from "./occasions";
import { ReadinessBanner } from "./readiness";
import { WhatWeKnow } from "./what-we-know";

/** The About row's value (ALL-127): "Mother · Birthday Mar 14". */
function aboutSummary(person: PersonDetail): string {
  const who = relationshipLabel(person.relationship);
  return person.birthday ? `${who} · Birthday ${monthDay(person.birthday)}` : who;
}

/** The Shipping address row's value: the street, what's missing, or a shared city. */
function addressSummary(address: PersonDetail["address"]): string {
  if (address.kind === "none") return "Not added";
  if (address.kind === "shared") return `${address.city}, ${address.state}`;
  if (Object.keys(address.problems).length > 0) return "Something's missing";
  return address.address.line1 ?? "Not added";
}

/** A bordered block of rows, like Settings' groups (ALL-115), with an optional heading. */
function RowGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5" aria-label={title ? undefined : "About"}>
      {title && <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>}
      <div className="divide-y divide-border rounded-xl border border-border">{children}</div>
    </section>
  );
}

/**
 * A person's page (T71): who they are, what we know, then a short
 * list of rows. Each row shows its value and opens its own screen, where it
 * changes. Without concierge access, what only the concierge does is left out.
 * An unknown, deleted or someone else's id is a 404.
 */
export async function PersonView({
  id,
  photoFailed,
  gifts,
}: {
  id: string;
  photoFailed: boolean;
  /** Their gifts in progress, which load on their own. */
  gifts?: React.ReactNode;
}) {
  const supabase = await createClient();
  const userId = (await supabase.auth.getClaims()).data?.claims?.sub;
  if (!userId) redirect("/");
  const person = await getPerson(id, await todayForRequest());
  if (!person) notFound();
  // With the card on, the top of the page has the link to their list, or asks for one, instead of
  // the Their list row. Read first, so off also stops the reads behind the link.
  const listAtTop = (await appSettingInt("list_link_card_enabled")) === 1;
  const showList = listAtTop && person.keepsList;
  const [profile, savedGifts, ideas, pastGifts, listPhotos, listToken, access] = await Promise.all([
    getProfile(supabase as unknown as Db, person.id, person.keepsList),
    countSavedGifts(person.id),
    onDemandIdeas(supabase as unknown as Db, person.id),
    hasPastGifts(person.id, supabase as unknown as Db, new Date()),
    showList ? getPersonListPhotos(person.id) : [],
    showList ? getPersonShareToken(person.id) : null,
    readAccess(),
  ]);
  // A failed check hides the concierge's parts, as no access does. Not where a
  // held gift would ship: that's money, so it's said unless there's surely none.
  const hasAccess = access?.access ?? false;
  const base = `/people/${person.id}`;

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
            {person.keepsList && <ListChecks className="size-3.5" aria-hidden="true" />}
            {person.keepsList ? "Their own list" : "No list linked"}
          </p>
        </div>
      </header>

      {showList && (
        // Straight to the list: the router would replay a redirect from Their list with an earlier
        // photo's gift still on it.
        <LinkedList
          name={person.name}
          href={listToken ? `/share/${listToken}` : `${base}/list`}
          photos={listToken ? listPhotos : []}
        />
      )}

      {listAtTop && !person.keepsList && (
        <ListLink variant="prompt" name={person.name} personId={person.id} keepsList={false} heldGiftNotice={access?.access !== false} linkAction={linkUnlinkedListAction} />
      )}

      {gifts}

      {photoFailed && (
        <p role="status" className="text-[13px] text-muted-foreground">
          The photo didn&apos;t save. Try again.
        </p>
      )}

      {hasAccess && profile.readiness && <ReadinessBanner personId={person.id} name={person.name} readiness={profile.readiness} />}

      <WhatWeKnow
        personId={person.id}
        name={person.name}
        knowledge={profile}
        hasAccess={hasAccess}
        questionsHref={profile.openCount > 0 ? `${base}/questions` : null}
        editAction={editFactAction}
        setActiveAction={setFactActiveAction}
        deleteAction={deleteFactAction}
        readAction={readCapturesAction}
      />

      <RowGroup>
        <SettingsRow href={`${base}/about`} label={`About ${person.name}`} value={aboutSummary(person)} />
      </RowGroup>

      <Occasions
        personId={person.id}
        occasions={person.occasions}
        hasAccess={hasAccess}
        remindersNote={access?.access === false}
        action={setOccasionEnabledAction}
      />

      <RowGroup title="Gifts">
        <BudgetRow
          personId={person.id}
          baseCents={person.baseBudgetCents}
          defaultCents={person.defaultBudgetCents}
          occasions={person.occasions}
        />
        {hasAccess && (
          <SettingsRow href={`${base}/ideas`} label="Gift ideas" value={ideas.length > 0 ? String(ideas.length) : "None"} />
        )}
        <SettingsRow
          href={`${base}/saved-gifts`}
          label="Saved gifts"
          value={savedGifts > 0 ? String(savedGifts) : "None"}
        />
        {pastGifts && <SettingsRow href={`${base}/gifts`} label="Past gifts" value="" />}
        {!listAtTop && (
          <SettingsRow href={`${base}/list`} label="Their list" value={person.keepsList ? "Linked" : "Not linked"} />
        )}
        <SettingsRow href={`${base}/address`} label="Shipping address" value={addressSummary(person.address)} />
      </RowGroup>

      <DeletePerson personId={person.id} name={person.name} action={deletePersonAction} />
    </>
  );
}
