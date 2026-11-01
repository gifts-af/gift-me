// Made-up people and gifts for the guided tour (ALL-46), the same ones as the
// ALL-41 mock-ups. Nothing here touches real data.

export const TOUR_STEPS = [
  { id: "people", caption: "We remember everyone's dates, and who keeps a list." },
  { id: "pick", caption: "Mom keeps her own list, so you pick from gifts she chose herself." },
  { id: "ship", caption: "Choose where it goes. Mom's address comes with her list." },
  { id: "done", caption: "That's it. We order it and track it to her door." },
  { id: "ideas", caption: "Dad has no list, so we suggest ideas from what you've saved about him." },
  { id: "list", caption: "Your own list, so people stop asking what you want." },
  { id: "end", caption: "That's where we're heading." },
] as const;

export type TourStepId = (typeof TOUR_STEPS)[number]["id"];

export type TourPerson = { name: string; occasion: string; source: string; status: string };

export const PEOPLE: TourPerson[] = [
  { name: "Mom", occasion: "Birthday · Sat, Mar 14", source: "Her own list · 6 wishes", status: "Pick from her list" },
  { name: "Dad", occasion: "Birthday · Fri, Apr 10", source: "No list · we suggest ideas", status: "Ideas ready" },
  { name: "Sam", occasion: "Christmas · Fri, Dec 25", source: "His own list", status: "Arrives Dec 20" },
];

export type TourGift = { id: string; name: string; note: string; price: number };

export const MOM_GIFTS: TourGift[] = [
  { id: "mug", name: "Stoneware mug set", note: "On her list since Feb 2 · arrives by Mar 10", price: 42 },
  { id: "planter", name: "Cast-iron herb planter", note: "On her list since Jan 18 · arrives by Mar 11", price: 68 },
  { id: "audiobook", name: "Audiobook credits", note: "On her list since Dec 30 · arrives instantly", price: 45 },
];

export const DAD_IDEAS: TourGift[] = [
  { id: "stones", name: "Sharpening stone set", note: "He wants a better sharpening stone", price: 38 },
  { id: "jacket", name: "Insulated shop jacket", note: "His shop is an unheated garage", price: 59 },
  { id: "grinder", name: "Hand-crank coffee grinder", note: "Loves strong coffee", price: 46 },
];

export const MY_LIST: { name: string; price: string }[] = [
  { name: "Pour-over coffee kettle", price: "$39.00" },
  { name: "Paperback: a mystery novel", price: "$14.50" },
  { name: "Rain jacket, size M", price: "$80.00" },
];

export function money(n: number): string {
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}
