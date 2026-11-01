// Public API of the Gift Concierge product (T19, design §2.2). Code outside
// modules/concierge imports only from here. Server code only: this pulls in
// the server-only admin client, so never import it from a client component.
export { getConciergeSettings, saveConciergeSettings } from "./settings";
export type { ConciergeSettings, SaveResult } from "./settings";

export { notify, sendTestNotification } from "./notify/notify";
export type { NotifyDeps, NotifyInput, NotifyResult } from "./notify/notify";
export { createSupabaseNotifyStore } from "./notify/store";
export type { LinkRow, NewLink, NotifyStore } from "./notify/store";
export { defaultChannels, emailChannel } from "./notify/channels";
export type { Channel } from "./notify/channels";
export type { ActionName } from "./notify/actions";
// Templates and samples of each: for the phone-check scripts (email-samples.ts, email-html.ts).
export { SAMPLE_DATA, TEMPLATES } from "./notify/templates";
export { sampleEmails } from "./notify/samples";
export type { SampleEmail } from "./notify/samples";
export type { NotificationKind, RenderedEmail } from "./notify/templates";
export { confirmActionLink, readActionLink } from "./notify/links";
export type { ConfirmResult, LinkDeps, LinkView } from "./notify/links";
