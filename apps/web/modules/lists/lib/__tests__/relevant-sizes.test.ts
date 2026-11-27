import { describe, expect, it } from "vitest";
import { SIZE_KINDS, type SharedSize, type SizeKind } from "@/lib/size-kinds";
import { relevantSizes, sizeKindsFor } from "../relevant-sizes";

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
  ["Cole Haan Original Grand Dress Shoes", ["shoe"]],
  ["Ralph Lauren Classic Dress Pants", ["pants"]],
  ["Diane von Furstenberg Wrap Dress", ["dress"]],
  ["Floral Maxi Dresses", ["dress"]],
  ["Levi's 501 Jeans", ["pants"]],
  ["Ring Video Doorbell", ["ring"]],
  ["Carhartt Knit Cuffed Beanie", ["hat"]],
  ["New Era 9FORTY Baseball Cap", ["hat"]],
  ["Patagonia Better Sweater Fleece Jacket", ["top"]],
  ["Carhartt Hooded Sweatshirt", ["top"]],
  ["Nike Dri-FIT Joggers", ["pants"]],
  ["Ugg Tasman Slippers", ["shoe"]],
  ["Birkenstock Arizona Sandals", ["shoe"]],
  ["Champion Powerblend Pullover Hoodie", ["top"]],
  ["J.Crew Cashmere Cardigan Sweater", ["top"]],
  ["Flannel Pajamas Set", ["top"]],
  ["Baby Onesie 3-Pack", ["top"]],
  ["Lululemon Align Leggings", ["pants"]],
  ["Pleated Mini Skirt", ["pants"]],
  ["Dockers Slim Chinos", ["pants"]],
  ["Carhartt Work Shorts", ["pants"]],
  ["Adrianna Papell Beaded Evening Gown", ["dress"]],
  ["Dress Shirt and Dress Pants", ["top", "pants"]],
  ["Silver Stacking Rings", ["ring"]],
  ["Nike Mercurial Soccer Cleats", ["shoe"]],
  ["Patagonia Down Sweater Vest", ["top"]],
  ["Equipment Slim Signature Silk Blouse", ["top"]],
  ["Ralph Lauren Polo", ["top"]],
  ["Classic Penny Loafers", ["shoe"]],
  ["Steve Madden Vala Stiletto Heels", ["shoe"]],
  ["Richardson 112 Trucker Hat", ["hat"]],
  ["Banana Republic Straight-Leg Trousers", ["pants"]],
  ["Brooks Brothers Madison Wool Coat", ["top"]],
  ["Reformation Juliette Midi Dress", ["dress"]],
  ["Converse Chuck Taylor All Star High Top", ["shoe"]],
  ["Cole Haan Cap Toe Oxford", ["shoe"]],
  ["Cotton TShirt", ["top"]],
  ["Dress Socks 6-Pack", ["shoe"]],
  ["Smartwool Hiking Socks", ["shoe"]],
  ["Nike Swoosh Sports Bra", ["bra"]],
  ["Lace Bralettes 3-Pack", ["bra"]],
  ["Pandora Charm Bracelet", EVERYTHING],
  ["Nike Dunk Low Top Sneakers", ["shoe"]],
  ["Vans Old Skool High Tops", ["shoe"]],
  ["Vans Sk8-Hi Hi-Tops", ["shoe"]],
  ["Bambu Lab A1 mini 3D Printer", EVERYTHING],
  ["Rage Against the ML", EVERYTHING],
  ["Dyson Airwrap", EVERYTHING],
];

describe("relevantSizes", () => {
  it.each(TABLE)("%s", (name, expected) => {
    expect(kindsFor(name, NO_COLOR)).toEqual(expected);
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

describe("sizeKindsFor (ALL-184: which size to ask for on add)", () => {
  it.each<[string, SizeKind[]]>([
    ["Flannel Shirt", ["top"]],
    ["Nike Air Max Sneakers", ["shoe"]],
    ["Men's Dress Shoes", ["shoe"]],
    ["Converse High Top", ["shoe"]],
    ["Wool Sweater and Beanie Set", ["top", "hat"]],
    ["Ring Light", ["ring"]],
    ["Stanley Tumbler", []],
    ["Dress Socks", ["shoe"]],
    ["Wool Sock", ["shoe"]],
    ["Sports Bra", ["bra"]],
    ["Bralette", ["bra"]],
    ["Bras", ["bra"]],
    ["Tennis Bracelet", []],
    ["Brand New Braided Leash", []],
  ])("%s → %j", (name, kinds) => {
    expect(sizeKindsFor(name)).toEqual(kinds);
  });

  it("never names favorite color", () => {
    expect(sizeKindsFor("Red Shirt")).toEqual(["top"]);
  });
});
