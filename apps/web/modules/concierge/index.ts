// Public API of the Gift Concierge product (T19, design §2.2). Code outside
// modules/concierge imports only from here.
export { getConciergeSettings, saveConciergeSettings } from "./settings";
export type { ConciergeSettings, SaveResult } from "./settings";
