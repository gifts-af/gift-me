// Public API of the lists product (T19, design §2.2). Code outside
// modules/lists imports only from "@/modules/lists"; the lint rule
// boundaries/entry-point enforces it.
export { default as GiftApp, GiftAppSkeleton } from "./components/gift-app";
export { default as SharedList } from "./components/shared-list";
export {
  getMyList,
  getMyListSummary,
  getOwnerBirthday,
  getOwnerSizes,
  getPersonListPhotos,
  getPersonShareToken,
  getSharedList,
  getSharePreview,
  UUID_PATTERN,
} from "./lib/lists";
// Link or unlink a person's list (ALL-123). Plain functions: the share page's
// server actions call them and log the events.
export { linkUnlinkedPerson, unlinkPerson } from "./lib/person-link";
export type { ListPhoto, MyList, SharedList as SharedListData } from "./lib/lists";
// The close route drops gifts held for Undo when a tab goes away (ALL-127).
export { LIST_ITEM_SOURCES, removeGifts } from "./lib/save-list";
// Reading a pasted gift link, for saved gifts on a person's page (ALL-93).
export { cleanGiftLink, readGiftLinkForUser } from "./actions/gift-link";
export type { GiftLinkRead } from "./lib/gift-link";
export { storeName } from "./lib/product-link";
// The daily tick deletes the stored photos of removed gifts (ALL-78).
export { removeDeletedPhotos } from "./lib/photo-cleanup";
// "Add to my list" from the Chrome extension (ALL-78): POST /api/lists/items.
export { addFromExtension, parseExtensionAddForm } from "./lib/extension-add";
export type { ExtensionAddResponse } from "./lib/extension-add";
export { extensionAddStoreFor } from "./lib/extension-add-store";
// "+ My list" on a shared list copies a gift, and its photo, to the viewer's list.
export { readStoredPhoto, setCopiedFrom, setGiftImageUrl, storedPhotoId } from "./lib/share-photo";
