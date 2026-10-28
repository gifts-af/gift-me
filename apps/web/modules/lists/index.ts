// Public API of the lists product (T19, design §2.2). Code outside
// modules/lists imports only from "@/modules/lists"; the lint rule
// boundaries/entry-point enforces it.
export { default as GiftApp, GiftAppSkeleton } from "./components/gift-app";
export { default as SharedList } from "./components/shared-list";
export { getMyList, getMyListSummary, getSharedList } from "./lib/lists";
export type { MyList, SharedList as SharedListData } from "./lib/lists";
