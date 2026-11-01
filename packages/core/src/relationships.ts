// How a person is related to the user, for the "add a person" form (ALL-22).
// Values are stored as-is, so keep them stable once data exists.

export type Relationship = "parent" | "partner" | "child" | "sibling" | "friend" | "other";

export const RELATIONSHIPS: readonly { value: Relationship; label: string }[] = [
  { value: "parent", label: "Parent" },
  { value: "partner", label: "Partner" },
  { value: "child", label: "Child" },
  { value: "sibling", label: "Sibling" },
  { value: "friend", label: "Friend" },
  { value: "other", label: "Other" },
];
