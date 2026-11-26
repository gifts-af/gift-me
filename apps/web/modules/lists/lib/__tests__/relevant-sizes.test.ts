import { describe, expect, it } from "vitest";
import { SIZE_KINDS, type SharedSize, type SizeKind } from "@/lib/size-kinds";
import { relevantSizes } from "../relevant-sizes";

const ALL: SharedSize[] = SIZE_KINDS.map(({ kind }) => ({ kind, value: `v-${kind}` }));
const NO_COLOR = ALL.filter((s) => s.kind !== "color");
const EVERYTHING: SizeKind[] = NO_COLOR.map((s) => s.kind);

const kindsFor = (name: string, shared: SharedSize[]) =>
  relevantSizes(name, shared).map((s) => s.kind);

// Every size except color is shared, so a miss shows them all.
const TABLE: [string, SizeKind[]][] = [
  ["Allbirds Wool Runners Sneakers", ["shoe"]],
  ["Women's Ankle BOOTS", ["shoe"]],
  ["Graphic T-Shirt", ["top"]],
  ["Men's Dress Shirt", ["top"]],
  ["Dress Shoes", ["shoe"]],
  ["Dress Pants", ["pants"]],
  ["Wrap Dress", ["dress"]],
  ["Floral Maxi Dresses", ["dress"]],
  ["Levi's 501 Jeans", ["pants"]],
  ["Ring Video Doorbell", ["ring"]],
  ["Wool Beanie", ["hat"]],
  ["New Era 9FORTY Baseball Cap", ["hat"]],
  ["Patagonia Better Sweater Fleece Jacket", ["top"]],
  ["Carhartt Hooded Sweatshirt", ["top"]],
  ["Nike Dri-FIT Joggers", ["pants"]],
  ["Ugg Tasman Slippers", ["shoe"]],
  ["Birkenstock Arizona Sandals", ["shoe"]],
  ["Hoodie", ["top"]],
  ["Cashmere Cardigan", ["top"]],
  ["Flannel Pajamas Set", ["top"]],
  ["Baby Onesie 3-Pack", ["top"]],
  ["Lululemon Align Leggings", ["pants"]],
  ["Pleated Mini Skirt", ["pants"]],
  ["Dockers Slim Chinos", ["pants"]],
  ["Carhartt Work Shorts", ["pants"]],
  ["Evening Gown", ["dress"]],
  ["Dress Shirt and Dress Pants", ["top", "pants"]],
  ["Silver Stacking Rings", ["ring"]],
  ["Nike Mercurial Soccer Cleats", ["shoe"]],
  ["Puffer Vest", ["top"]],
  ["Silk Blouse", ["top"]],
  ["Ralph Lauren Polo", ["top"]],
  ["Classic Penny Loafers", ["shoe"]],
  ["Stiletto Heels", ["shoe"]],
  ["Camp Trucker Hat", ["hat"]],
  ["Straight-Leg Trousers", ["pants"]],
  ["Wool Overcoat Coat", ["top"]],
  ["Sleeveless Dress", ["dress"]],
  ["Dress", ["dress"]],
  ["Bambu Lab A1 mini 3D Printer", EVERYTHING],
  ["Rage Against the ML", EVERYTHING],
  ["Dyson Airwrap", EVERYTHING],
];

describe("relevantSizes", () => {
  it.each(TABLE)("%s", (name, expected) => {
    expect(kindsFor(name, NO_COLOR)).toEqual(expected);
  });

  it("covers at least 30 store names", () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(30);
  });

  it("always includes favorite color when shared", () => {
    expect(kindsFor("Allbirds Wool Runners Sneakers", ALL)).toEqual(["shoe", "color"]);
    expect(kindsFor("Wrap Dress", ALL)).toEqual(["dress", "color"]);
  });

  it("returns only color when only color is shared and nothing matches", () => {
    expect(kindsFor("Dyson Airwrap", [{ kind: "color", value: "Green" }])).toEqual(["color"]);
  });

  it("returns all shared when nothing matches", () => {
    const shared = [ALL[0], ALL[3]];
    expect(relevantSizes("Dyson Airwrap", shared)).toEqual(shared);
  });

  it("shows only the color when the matched kind is not shared", () => {
    const shared: SharedSize[] = [
      { kind: "hat", value: "M" },
      { kind: "color", value: "Green" },
    ];
    expect(relevantSizes("Running Shoes", shared)).toEqual([{ kind: "color", value: "Green" }]);
  });

  it("shows nothing when the matched kind and color are not shared", () => {
    expect(relevantSizes("Running Shoes", [{ kind: "hat", value: "M" }])).toEqual([]);
  });

  it("keeps SIZE_KINDS order whatever the input order", () => {
    expect(kindsFor("Hat and Sneakers and Jeans", [...ALL].reverse())).toEqual([
      "pants",
      "shoe",
      "hat",
      "color",
    ]);
  });

  it("returns an empty list when nothing is shared", () => {
    expect(relevantSizes("Wool Beanie", [])).toEqual([]);
  });
});
