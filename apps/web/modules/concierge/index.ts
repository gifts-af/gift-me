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
// Chrome extension capture (ALL-22). SaveResult is aliased: settings exports one.
export { parseCaptureForm, saveCapture } from "./capture/capture";
export type { CaptureInput, SaveResult as CaptureSaveResult } from "./capture/capture";
export type { CaptureStore, NewCaptureRow } from "./capture/store";
export { confirmActionLink, readActionLink } from "./notify/links";
export type { ConfirmResult, LinkDeps, LinkView } from "./notify/links";
export { createCookieCaptureStore, createSupabaseCaptureStore } from "./capture/supabase-store";
// Reading captures into AI-suggested facts (ALL-25).
export { CaptureNotFound, processCapture } from "./capture/extract";
export type { Extraction, SavedFact } from "./capture/extract";
export { readUnreadCaptures } from "./capture/facts";
// The profile: what we know, guided questions, the readiness meter (ALL-26).
export {
  activeFacts,
  answerQuestions,
  deleteFact,
  getOpenQuestions,
  getProfile,
  setFactActive,
  skipQuestion,
  updateFact,
} from "./profile/profile";
export type { ActiveFact, Db, Profile, ProfileFact, Readiness } from "./profile/profile";
export { SENSITIVE_REFUSAL, isId, parseAnswers, parseFactEdit } from "./profile/rules";
export type { Answer } from "./profile/rules";

// People, occasions and budgets (ALL-21). Birthday and other occasion rules
// live in packages/core; parsing of the forms is in people/rules.ts.
export {
  addPerson,
  deletePerson,
  getPerson,
  importPeople,
  linkList,
  listImportedContactIds,
  listPeople,
  removeAddress,
  saveAddress,
  setBudget,
  setOccasionEnabled,
  setPhoto,
  unlinkList,
  updatePerson,
} from "./people/people";
export type { AddResult, ImportResult, PersonAddress, PersonCard, PersonDetail } from "./people/people";
export { parseAddressForm, parseBudget, parseImportRows, parsePersonForm, parseShareToken } from "./people/rules";
export type { AddressSaveResult, ImportAddress, ImportRow, PersonInput } from "./people/rules";

// The round engine (ALL-28): the daily tick, advancing one round, and resuming
// rounds that waited for an address. The idea stub stands in for ALL-27.
export { advanceRound, resumeRoundsForPerson, runTick } from "./rounds/engine";
export type { AdvanceResult, EngineDeps, EngineZinc, GenerateIdeas, TickSummary } from "./rounds/engine";
export { createSupabaseRoundStore } from "./rounds/store";
export type { Candidate, ClaimedRound, NewRoundRow, RoundContext, RoundFinish, RoundOrder, RoundStore } from "./rounds/store";
export { createStubGenerateIdeas } from "./rounds/ideas";

// Paying for gifts from the user's own Zinc wallet (ALL-32): connect, phone, disconnect, Settings status.
export {
  cancelConnect,
  disconnect as disconnectZinc,
  fundingLookahead,
  getPaymentStatus,
  getZincWallet,
  pollConnect,
  savePhone,
  startConnect,
} from "./zinc/connect";
export type { PaymentResult, PaymentStatus } from "./zinc/connect";
export type { PlaceHeld, ZincDeps } from "./zinc/types";
export { handleZincWebhook } from "./zinc/events";
export { hasPaidFeatures } from "./paid-features";
// Approving and buying from the user's own Zinc wallet (ALL-30, ALL-32 Task 6). The tick, the
// webhook route, Settings and the people actions bind these in app/settings/zinc-deps.ts.
export { approveAndBuy } from "./purchase/approve";
export type { ApproveError, ApproveInput, ApproveResult } from "./purchase/approve";
export { placeHeldForUser, placeRound, sweepStalePlacing } from "./purchase/place";
export type { PlaceOutcome } from "./purchase/place";
export type { PurchaseDeps } from "./purchase/store";
