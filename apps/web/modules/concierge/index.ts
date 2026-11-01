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
// Templates and their sample data: for scripts/email-samples.ts phone checks.
export { SAMPLE_DATA, TEMPLATES } from "./notify/templates";
export type { NotificationKind, RenderedEmail } from "./notify/templates";
export { confirmActionLink, readActionLink } from "./notify/links";
export type { ConfirmResult, LinkDeps, LinkView } from "./notify/links";

// People, occasions and budgets (ALL-21). Birthday and other occasion rules
// live in packages/core; parsing of the forms is in people/rules.ts.
export {
  addPerson,
  deletePerson,
  getPerson,
  linkList,
  listPeople,
  setBudget,
  setOccasionEnabled,
  setPhoto,
  unlinkList,
  updatePerson,
} from "./people/people";
export type { AddResult, PersonCard, PersonDetail } from "./people/people";
export { parseBudget, parsePersonForm, parseShareToken } from "./people/rules";
export type { PersonInput } from "./people/rules";
