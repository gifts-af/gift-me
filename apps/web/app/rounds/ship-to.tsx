"use client";

import { checkAddress, type AddressField } from "@gifts-af/core";
import { AddressForm, type AddressValues } from "@/components/address/address-form";

// Where a gift ships, on the confirm and fix pages (ALL-29 AC-10, AC-15a; ALL-41 "Where it goes";
// D38, T61). The page reads only city and state for the choices. The street goes to the server
// only for "Another address", in the form, and is checked there again.

/** The person's address as the choices show it: a list owner's shared one, or a complete one saved here. */
export type RecipientAddress = { kind: "shared"; city: string; state: string } | { kind: "own"; city: string; state: string } | { kind: "none" };
export type Place = { city: string; state: string };
export type ShipChoice = { kind: "recipient" } | { kind: "buyer" } | { kind: "other"; address: AddressValues; saveToPerson: boolean };

const FIELDS: AddressField[] = ["firstName", "lastName", "line1", "line2", "city", "state", "zip"];
export const EMPTY_ADDRESS: AddressValues = { firstName: "", lastName: "", line1: "", line2: "", city: "", state: "", zip: "" };

export const place = (p: Place) => `${p.city}, ${p.state}`;

/** The choice, as the buy and replace actions read it. */
export function putShipTo(form: FormData, choice: ShipChoice): void {
  form.set("shipTo", choice.kind);
  if (choice.kind !== "other") return;
  for (const f of FIELDS) form.set(f, choice.address[f]);
  if (choice.saveToPerson) form.set("saveToPerson", "1");
}

/** "Mom · Portland, OR", for the Ships to row. */
export function shipsToLabel(choice: ShipChoice, personName: string, recipient: RecipientAddress, buyer: Place | null): string {
  if (choice.kind === "buyer") return buyer ? `You · ${place(buyer)}` : "You · no address yet";
  if (choice.kind === "other") return `${choice.address.firstName} ${choice.address.lastName} · ${choice.address.city}, ${choice.address.state}`;
  return recipient.kind === "none" ? `${personName} · no address yet` : `${personName} · ${place(recipient)}`;
}

export const personAddressHref = (personId: string, next: string) => `/people/${personId}/address?open=1&next=${encodeURIComponent(next)}`;
export const myAddressHref = (next: string) => `/settings/address?next=${encodeURIComponent(next)}`;

/**
 * "Another address": the app's address form, checked here so mistakes show by their fields,
 * and kept on the page until Buy. Saving it to the person is offered only when no list owner
 * shares an address for them (T61).
 */
export function OtherAddressForm({
  start,
  personName,
  canSave,
  saveToPerson,
  onSaveToPerson,
  submitLabel,
  onUse,
  onCancel,
}: {
  start: AddressValues;
  personName: string;
  canSave: boolean;
  saveToPerson: boolean;
  onSaveToPerson: (v: boolean) => void;
  submitLabel: string;
  onUse: (address: AddressValues) => Promise<void> | void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {canSave && (
        <label className="flex min-h-11 items-center gap-3 text-[15px]">
          <input
            type="checkbox"
            checked={saveToPerson}
            onChange={(e) => onSaveToPerson(e.target.checked)}
            className="size-5 flex-none accent-primary"
          />
          {`Save as ${personName}'s address`}
        </label>
      )}
      <AddressForm
        start={start}
        submitLabel={submitLabel}
        save={async (form) => {
          const draft = Object.fromEntries(FIELDS.map((f) => [f, String(form.get(f) ?? "")])) as AddressValues;
          const checked = checkAddress(draft);
          if (!checked.ok) return { ok: false, error: "Check the address.", fields: checked.errors };
          await onUse(draft);
          return { ok: true };
        }}
        onDone={onCancel}
      />
    </div>
  );
}
