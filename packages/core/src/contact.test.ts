import { describe, expect, it } from "vitest";
import { CONTACT_REMOVED, stripContactDetails } from "./contact";

const X = CONTACT_REMOVED;

describe("stripContactDetails (ALL-134)", () => {
  it.each([
    // Emails
    ["write to bob@example.com", `write to ${X}`],
    ["email Jane.Doe+gifts@mail.co.uk please", `email ${X} please`],
    // Phones
    ["call (555) 123-4567", `call ${X}`],
    ["call 555-123-4567 after 5", `call ${X} after 5`],
    ["cell 555.123.4567", `cell ${X}`],
    ["cell 555 123 4567", `cell ${X}`],
    ["+1 555 123 4567", X],
    ["+1-555-123-4567", X],
    ["+1 (555) 123-4567 evenings", `${X} evenings`],
    ["uk +44 20 7946 0958", `uk ${X}`],
    ["paris +33 1 23 45 67 89", `paris ${X}`],
    ["berlin +49 30 12345678", `berlin ${X}`],
    ["text 5551234567", `text ${X}`],
    ["text 15551234567", `text ${X}`],
    ["mobile 07700 900123", `mobile ${X}`],
    ["office 555-123-4567 x12", `office ${X}`],
    ["office 555-123-4567 ext 12", `office ${X}`],
    ["office (555) 123-4567 ext. 1234 mornings", `office ${X} mornings`],
    // Street addresses
    ["loves letters, write to 12 Elm St", `loves letters, write to ${X}`],
    ["write to 12 elm street", `write to ${X}`],
    ["write to 12 elm st", `write to ${X}`],
    ["12 oak ave", X],
    ["12 oak rd", X],
    ["12 sunset blvd", X],
    ["12 maple ln", X],
    ["12 birch ct", X],
    ["12 cedar pl", X],
    ["12 St. Marks Pl", X],
    ["lives at 4500 N. Main Street Apt 3, Springfield", `lives at ${X}, Springfield`],
    ["send it to 221B Baker Street", `send it to ${X}`],
    ["moved to 77 West 5th Ave.", `moved to ${X}`],
    ["10 Downing Road, Suite 200", X],
    ["12 Elm St, Springfield, IL 62704", X],
    ["12 Elm St Springfield IL 62704-1234 is home", `${X} is home`],
    ["12 elm st apt 4b", X],
    ["12 Elm St, UNIT 7", X],
    // Units on their own
    ["she's in Flat 3", `she's in ${X}`],
    ["apt 4b", X],
    ["APARTMENT 12", X],
    ["Suite 200", X],
    // PO boxes
    ["mail to PO Box 12", `mail to ${X}`],
    ["mail to P.O. Box 4410", `mail to ${X}`],
    ["mail to po box 9", `mail to ${X}`],
    // Several
    ["two: a@b.co and 555-123-4567", `two: ${X} and ${X}`],
  ])("strips %j", (text, want) => {
    expect(stripContactDetails(text)).toBe(want);
  });

  it.each([
    "wants a $24.99 mug",
    "spends about 25 dollars",
    "graduates in 2026",
    "shoe size 10.5",
    "jeans 32x34",
    "8 oz coffee bags",
    "has an iPhone 15",
    "plays PS5",
    "turns 40 this year",
    "has 3 kids",
    "loves the band Route 66",
    "drove Route 66 in 2019",
    "shops on Main Street",
    "anniversary 2026-11-22",
    "birthday 11/22/1980",
    "wedding on 22.11.2026",
    "married 2001-2026",
    "ran a 5K and 2 marathons",
    "owns a 1967 Mustang",
    "reads 3 books a week",
    "a 3 hour drive away",
    "a 2 day road trip",
    "takes the long way",
    "Nike Air Max 90",
    "budget $1,250.00 for 2 people",
    "Into: Taylor Swift 1989",
    "Already has: Kindle Paperwhite 11th gen",
    "#1 dad",
    "kids are 10 12 14 16 18",
    "jersey numbers 23 24 33 45 99 12",
    "collects 1985 1986 1987 coins",
    "World Series 2016 2020 2024",
    "between 1990 and 2001 2005 2010",
    "ISBN 978-0-306-40615-7",
    "UPC 0 12345 67890 5",
    "SKU 1234 5678 9012",
  ])("leaves %j alone", (text) => {
    expect(stripContactDetails(text)).toBe(text);
  });

  it("strips a number before a street word even when it's not an address (accepted trade-off: privacy first, T42)", () => {
    expect(stripContactDetails("bought 2 Main St signs")).toBe(`bought ${X} signs`);
  });
});
