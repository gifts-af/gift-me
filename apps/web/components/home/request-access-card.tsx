import { requestAccessAction } from "@/app/give/actions";
import { RequestAccess } from "@/app/give/request-access";
import { readAccess } from "@/components/concierge-gate";

/** On Give, under People: the way to ask for the concierge, for someone without it. */
export async function RequestAccessCard() {
  const state = await readAccess();
  if (!state) {
    return (
      <p role="alert" className="text-[15px] text-muted-foreground">
        We couldn&apos;t check your access. Refresh to try again.
      </p>
    );
  }
  if (state.access) return null;
  return (
    <div className="max-w-2xl rounded-lg border bg-card p-4">
      <RequestAccess
        action={requestAccessAction}
        requested={state.requested}
        ask={
          <section aria-labelledby="request-access-heading" className="flex flex-col gap-1.5">
            <h2 id="request-access-heading" className="text-lg font-semibold">
              Want gifts found and shipped for you?
            </h2>
            <p className="text-[15px] text-muted-foreground">
              Gift ideas, reminders and buying come with the concierge. Request access and we&apos;ll email you when you&apos;re in.
            </p>
          </section>
        }
        sent={<p className="text-[15px]">You asked for access. We&apos;ll email you when you&apos;re in.</p>}
      />
    </div>
  );
}
