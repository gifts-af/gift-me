import { expect, it } from "vitest";
import { chooseBy } from "../occasion-format";

it("is the day before the ship-by day, since buying is refused on it", () => {
  expect(chooseBy("2026-12-25")).toBe("Thu, Dec 24");
  expect(chooseBy("2027-01-01")).toBe("Thu, Dec 31");
});
