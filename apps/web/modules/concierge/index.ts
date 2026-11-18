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
  confirmFact,
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
  removeDatedOccasion,
  renamePerson,
  saveAddress,
  saveBudgets,
  setBirthYear,
  setDatedOccasion,
  setOccasionEnabled,
  setPhoto,
  setRelationship,
  unlinkList,
} from "./people/people";
export type { AddResult, DatedKind, ImportResult, PersonAddress, PersonCard, PersonDetail } from "./people/people";
export {
  parseAddressForm,
  parseBirthYear,
  parseBudget,
  parseBudgetForm,
  parseImportRows,
  parseMonthDay,
  parsePersonForm,
  parseShareToken,
} from "./people/rules";
// Saved gifts for someone, private to the buyer (ALL-93).
export { countSavedGifts, listSavedGifts, removeSavedGift, saveGift, saveIdea, savedProductIds } from "./saved-gifts/saved-gifts";
export { parseSavedGiftForm } from "./saved-gifts/rules";
export type { SavedGift, SavedGiftInput } from "./saved-gifts/rules";
export type { AddressSaveResult, ImportAddress, ImportRow, PersonInput } from "./people/rules";

// The round engine (ALL-28): the daily tick and advancing one round. Ideas come from the
// idea engine below (ALL-27), bound in app/settings/zinc-deps.ts.
export { advanceRound, runRoundJob, runTick, tellOrdered } from "./rounds/engine";
export type { AdvanceResult, EngineDeps, EngineZinc, GenerateIdeas, JobResult, TickSummary } from "./rounds/engine";
export { planJobs } from "./rounds/fanout";
export type { JobMessage, QueuedJob, SendJobs } from "./rounds/fanout";
export { createSupabaseRoundStore } from "./rounds/store";
export type { Candidate, ClaimedRound, NewRoundRow, RoundContext, RoundFinish, RoundOrder, RoundStore } from "./rounds/store";
export { clearUnfiledNotes } from "./inbound/cleanup";
export type { InboundCleanup } from "./inbound/cleanup";

// Paying for gifts from the user's own Zinc wallet (ALL-32): connect, phone, disconnect, Settings status.
export {
  cancelConnect,
  disconnect as disconnectZinc,
  fundingLookahead,
  getPaymentStatus,
  getPaymentSummary,
  getZincWallet,
  hasZincConnection,
  pollConnect,
  savePhone,
  startConnect,
} from "./zinc/connect";
export type { DisconnectDeps, PaymentResult, PaymentStatus, PaymentSummary } from "./zinc/connect";
export type { PlaceAddressHeld, PlaceHeld, ZincDeps } from "./zinc/types";
export { handleZincWebhook } from "./zinc/events";
export { readWebhookBody } from "./zinc/guard";
export { hasPaidFeatures } from "./paid-features";
// Approving and buying from the user's own Zinc wallet (ALL-30, ALL-32 Task 6). The tick, the
// webhook route, Settings and the people actions bind these in app/settings/zinc-deps.ts.
export { approveAndBuy } from "./purchase/approve";
export type { ApproveError, ApproveInput, ApproveResult } from "./purchase/approve";
export { placeAddressHeld as placeAddressHeldFor, placeHeldForUser, placeRound, sweepStalePlacing } from "./purchase/place";
export type { PlaceOutcome } from "./purchase/place";
export type { PurchaseDeps } from "./purchase/store";
// Notes emailed to the notes address (ALL-31): the webhook route binds these.
export { handleInbound } from "./inbound/handle";
export type { InboundDeps, InboundOutcome } from "./inbound/handle";
export { createSupabaseInboundStore } from "./inbound/supabase-store";
export type { InboundStore } from "./inbound/store";
export { sendNotesTipOnce } from "./inbound/tip";
export { captureStoreFor } from "./capture/supabase-store";
// The gift idea engine (ALL-27): one run, its database glue, and what the Gift ideas screen reads.
export { runIdeas } from "./ideas/run";
export type { IdeaDeps, IdeaOutcome, IdeaRequest } from "./ideas/run";
export { createSupabaseIdeaStore } from "./ideas/store";
export type { AdminDb, IdeaInputs, IdeaRefusal, IdeaSettings, IdeaStore, SavedIdea } from "./ideas/store";
export { ideaRunOffer, onDemandIdeas, type IdeaRunOffer } from "./ideas/read";
export type { ShownIdea } from "./ideas/read";
