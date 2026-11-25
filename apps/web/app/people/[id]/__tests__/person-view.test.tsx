import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const getPerson = vi.hoisted(() => vi.fn());
const cardEnabled = vi.hoisted(() => ({ value: 1 }));
const getProfile = vi.hoisted(() =>
  vi.fn(async (...args: unknown[]) => (void args, { groups: [], off: [], unread: 0, openCount: 0, readiness: null as unknown })),
);
const countSavedGifts = vi.hoisted(() => vi.fn(async (...args: unknown[]) => (void args, 0)));
const onDemandIdeas = vi.hoisted(() => vi.fn(async (...args: unknown[]) => (void args, [] as unknown[])));
const readAccess = vi.hoisted(() => vi.fn());
const hasPastGifts = vi.hoisted(() => vi.fn(async (...args: unknown[]) => (void args, false)));
vi.mock("@/modules/concierge", () => ({ hasPastGifts, getPerson, getProfile, countSavedGifts, onDemandIdeas }));
vi.mock("@/components/concierge-gate", () => ({ readAccess }));
const getPersonListPhotos = vi.hoisted(() => vi.fn(async (...args: unknown[]) => (void args, [] as { giftId: string; name: string; url: string }[])));
const getPersonShareToken = vi.hoisted(() => vi.fn(async (...args: unknown[]) => (void args, "tok" as string | null)));
vi.mock("@/modules/lists", () => ({ getPersonListPhotos, getPersonShareToken }));
vi.mock("@/lib/app-settings", () => ({ appSettingInt: async () => cardEnabled.value }));
vi.mock("@/lib/today", () => ({ todayForRequest: async () => "2026-11-01" }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) } }),
}));
vi.mock("../../actions", () => {
  const action = async () => ({ ok: true });
  return {
    deletePersonAction: action, setOccasionEnabledAction: action, editFactAction: action, setFactActiveAction: action,
    deleteFactAction: action, readCapturesAction: action, confirmFactAction: action,
    linkUnlinkedListAction: action, linkListAction: action, unlinkListAction: action,
  };
});
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
vi.mock("next/navigation", () => ({
  notFound,
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { PersonView } from "../person-view";

const dad = {
  id: "p1", name: "Dad", relationship: "father", photoUrl: null, photoPath: null, keepsList: false, hasBirthday: true,
  next: { kind: "birthday", date: "2027-04-10" }, birthYear: null, birthday: { month: 4, day: 10 }, anniversary: null,
  occasions: [
    { kind: "birthday", enabled: true, date: "2027-04-10", orderBy: { date: "2027-04-01", fast: false }, budgetCents: null },
  ],
  address: { kind: "none" },
};

async function show(photoFailed = false) {
  return render(await PersonView({ id: "p1", photoFailed }));
}

describe("PersonView", () => {
  beforeEach(() => {
    getPerson.mockReset();
    readAccess.mockResolvedValue({ access: true, requested: false });
    cardEnabled.value = 1;
  });

  it("is a 404 for a person who is not found", async () => {
    getPerson.mockResolvedValue(null);
    await expect(PersonView({ id: "nope", photoFailed: false })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  // ALL-127 AC-1: what we know, then rows for who they are, occasions and gifts.
  it("shows who they are, what we know, then rows, with no forms", async () => {
    getPerson.mockResolvedValue(dad);
    await show();
    expect(screen.getByRole("heading", { level: 1, name: "Dad" })).toBeInTheDocument();
    expect(screen.getByText("No list linked").querySelector("svg")).toBeNull();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Does Dad have a GiftsAF list?", "What we know", "Occasions", "Gifts"]);
    expect(getProfile.mock.calls[0].slice(1)).toEqual(["p1", false]);
    expect(screen.getByRole("switch", { name: "Birthday" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Delete Dad" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // The Edit form and the inline sections are gone; the only field is the list prompt's.
    expect(screen.getAllByRole("textbox").map((t) => t.getAttribute("name"))).toEqual(["link"]);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add an address" })).toBeNull();
    expect(screen.queryByRole("button", { name: /photo/i })).toBeNull();
  });

  // ALL-167
  it("puts their gifts in progress under the list prompt and above what we know", async () => {
    getPerson.mockResolvedValue(dad);
    render(await PersonView({ id: "p1", photoFailed: false, gifts: <p>Their gifts</p> }));
    const gifts = screen.getByText("Their gifts");
    const prompt = screen.getByRole("heading", { name: "Does Dad have a GiftsAF list?" });
    const know = screen.getByRole("heading", { name: "What we know" });
    expect(prompt.compareDocumentPosition(gifts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gifts.compareDocumentPosition(know) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // ALL-123: an unlinked person's page asks for the list link at the top, in place of the row.
  describe("the list prompt", () => {
    it("shows first, with the copy, the paste box and the notice, and no Their list row", async () => {
      getPerson.mockResolvedValue(dad);
      await show();
      const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
      expect(headings[0]).toBe("Does Dad have a GiftsAF list?");
      expect(screen.getByText("Paste the link they sent you to link their list.")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Their list link" })).toBeInTheDocument();
      expect(screen.getByText("If a gift for them is waiting on an address, it will ship to this list's owner.")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Their list/ })).toBeNull();
    });

    it("gives way to one link to their list, above their gifts in progress, for a linked person", async () => {
      getPerson.mockResolvedValue({ ...dad, keepsList: true });
      render(await PersonView({ id: "p1", photoFailed: false, gifts: <p>Their gifts</p> }));
      expect(screen.queryByText("Does Dad have a GiftsAF list?")).toBeNull();
      expect(screen.getByRole("heading", { level: 2, name: "Dad's GiftsAF list" })).toBeInTheDocument();
      const link = screen.getByRole("link", { name: "See their list" });
      expect(link).toHaveAttribute("href", "/share/tok");
      expect(link.compareDocumentPosition(screen.getByText("Their gifts")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByRole("link", { name: /^Their list/ })).toBeNull();
    });

    it("shows the photos of gifts on their list beside the link", async () => {
      getPerson.mockResolvedValue({ ...dad, keepsList: true });
      getPersonListPhotos.mockResolvedValueOnce([
        { giftId: "g1", name: "Kettle", url: "https://x.test/1.jpg" },
        { giftId: "g2", name: "Socks", url: "https://x.test/2.jpg" },
      ]);
      const { container } = await show();
      expect(getPersonListPhotos.mock.calls.at(-1)).toEqual(["p1"]);
      const photos = [...container.querySelectorAll("img")];
      expect(photos.map((i) => i.getAttribute("src"))).toEqual(["https://x.test/1.jpg", "https://x.test/2.jpg"]);
      for (const photo of photos) expect(photo).toHaveAttribute("referrerpolicy", "no-referrer");
      // Each opens the list at its own gift.
      expect(screen.getByRole("link", { name: "See Kettle on their list" })).toHaveAttribute("href", "/share/tok#gift-g1");
      expect(screen.getByRole("link", { name: "See Socks on their list" })).toHaveAttribute("href", "/share/tok#gift-g2");
      // A photo the store no longer serves leaves no broken image.
      fireEvent.error(photos[0]);
      expect([...container.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toEqual(["https://x.test/2.jpg"]);
      expect(screen.queryByRole("link", { name: "See Kettle on their list" })).toBeNull();
    });

    it("falls back to Their list, with no photos, when the list's link can't be read", async () => {
      getPerson.mockResolvedValue({ ...dad, keepsList: true });
      getPersonShareToken.mockResolvedValueOnce(null);
      getPersonListPhotos.mockResolvedValueOnce([{ giftId: "g1", name: "Kettle", url: "https://x.test/1.jpg" }]);
      const { container } = await show();
      expect(screen.getByRole("link", { name: "See their list" })).toHaveAttribute("href", "/people/p1/list");
      expect(container.querySelectorAll("img")).toHaveLength(0);
    });

    it("has no list link for an unlinked person, and reads no list", async () => {
      getPersonListPhotos.mockClear();
      getPerson.mockResolvedValue(dad);
      await show();
      expect(getPersonListPhotos).not.toHaveBeenCalled();
      expect(screen.queryByRole("link", { name: "See their list" })).toBeNull();
    });

    it("keeps a linked person's Their list row with the setting at 0, with no link at the top and no list read", async () => {
      getPersonListPhotos.mockClear();
      getPersonShareToken.mockClear();
      cardEnabled.value = 0;
      getPerson.mockResolvedValue({ ...dad, keepsList: true });
      await show();
      expect(screen.getByRole("link", { name: /^Their list/ })).toHaveTextContent("Linked");
      expect(screen.queryByRole("link", { name: "See their list" })).toBeNull();
      expect(getPersonListPhotos).not.toHaveBeenCalled();
      expect(getPersonShareToken).not.toHaveBeenCalled();
    });

    it("is off with the setting at 0: today's Not linked row instead", async () => {
      cardEnabled.value = 0;
      getPerson.mockResolvedValue(dad);
      await show();
      expect(screen.queryByText("Does Dad have a GiftsAF list?")).toBeNull();
      expect(screen.getByRole("link", { name: /^Their list/ })).toHaveTextContent("Not linked");
    });
  });

  it("has an About row with the relationship and birthday, opening About", async () => {
    getPerson.mockResolvedValue(dad);
    await show();
    const about = screen.getByRole("link", { name: /^About Dad/ });
    expect(about).toHaveAttribute("href", "/people/p1/about");
    expect(about).toHaveTextContent("Father · Birthday Apr 10");
  });

  it("leaves the birthday out of the About row when there isn't one", async () => {
    getPerson.mockResolvedValue({ ...dad, birthday: null });
    await show();
    expect(screen.getByRole("link", { name: /^About Dad/ })).toHaveTextContent(/Father$/);
  });

  it("has the gift rows, each opening its own screen", async () => {
    cardEnabled.value = 0;
    getPerson.mockResolvedValue(dad);
    await show();
    const row = (name: RegExp) => screen.getByRole("link", { name });
    expect(row(/^Budget/)).toHaveAttribute("href", "/people/p1/budget");
    expect(row(/^Saved gifts/)).toHaveAttribute("href", "/people/p1/saved-gifts");
    expect(row(/^Saved gifts/)).toHaveTextContent("None");
    expect(row(/^Their list/)).toHaveAttribute("href", "/people/p1/list");
    expect(row(/^Their list/)).toHaveTextContent("Not linked");
    expect(row(/^Shipping address/)).toHaveAttribute("href", "/people/p1/address");
    expect(row(/^Shipping address/)).toHaveTextContent("Not added");
  });

  // ALL-27: after Budget, how many on-demand ideas there are.
  it("the Gifts group has a Gift ideas row with the count", async () => {
    getPerson.mockResolvedValue(dad);
    const { unmount } = await show();
    const row = () => screen.getByRole("link", { name: /^Gift ideas/ });
    expect(row()).toHaveAttribute("href", "/people/p1/ideas");
    expect(row()).toHaveTextContent("None");
    const labels = screen.getAllByRole("link").map((l) => l.firstChild?.textContent);
    expect(labels.indexOf("Gift ideas")).toBe(labels.indexOf("Budget") + 1);
    expect(onDemandIdeas.mock.calls[0][1]).toBe("p1");
    unmount();
    onDemandIdeas.mockResolvedValueOnce([{ id: "i1" }, { id: "i2" }, { id: "i3" }]);
    await show();
    expect(row()).toHaveTextContent("3");
  });

  it("has a Past gifts row only when there are some", async () => {
    getPerson.mockResolvedValue(dad);
    const { unmount } = await show();
    expect(screen.queryByRole("link", { name: "Past gifts" })).toBeNull();
    expect(hasPastGifts.mock.calls[0][0]).toBe("p1");
    unmount();
    hasPastGifts.mockResolvedValueOnce(true);
    await show();
    expect(screen.getByRole("link", { name: "Past gifts" })).toHaveAttribute("href", "/people/p1/gifts");
  });

  it("counts saved gifts, and says Their own list for someone with a list", async () => {
    getPerson.mockResolvedValue({ ...dad, keepsList: true });
    countSavedGifts.mockResolvedValueOnce(2);
    await show();
    expect(screen.getByText("Their own list").querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("link", { name: /^Saved gifts/ })).toHaveTextContent("2");
  });

  it("sums up the address: the street, or what's missing", async () => {
    const own = (problems: Record<string, string>) => ({
      kind: "own",
      address: { firstName: "Dad", lastName: "A", line1: "12 Oak Lane", line2: null, city: "Tampa", state: "FL", zip: "33602" },
      problems,
    });
    getPerson.mockResolvedValue({ ...dad, address: own({}) });
    const { unmount } = await show();
    expect(screen.getByRole("link", { name: /^Shipping address/ })).toHaveTextContent("12 Oak Lane");
    unmount();
    getPerson.mockResolvedValue({ ...dad, address: own({ zip: "Enter a 5-digit ZIP code." }) });
    await show();
    expect(screen.getByRole("link", { name: /^Shipping address/ })).toHaveTextContent("Something's missing");
  });

  it("never puts a shared address's street in the page (ALL-81 AC-12)", async () => {
    getPerson.mockResolvedValue({ ...dad, keepsList: true, address: { kind: "shared", city: "Tampa", state: "FL" } });
    const { container } = await show();
    expect(screen.getByRole("link", { name: /^Shipping address/ })).toHaveTextContent("Tampa, FL");
    expect(container.innerHTML).not.toMatch(/Oak|line1/);
  });

  describe("the concierge's parts", () => {
    const REMINDERS = "Reminders come with the concierge.";
    const readiness = { score: 40, label: "Ideas could be better", step: { kind: "answer", count: 3 } };
    const late = { ...dad, occasions: [...dad.occasions, { kind: "christmas", enabled: true, date: "2026-12-25", orderBy: null, budgetCents: null }] };
    const parts = () => ({
      readiness: screen.queryByText("Ideas could be better") !== null,
      ideas: screen.queryByRole("link", { name: /^Gift ideas/ }) !== null,
      orderBy: screen.queryByText(/^Order by/) !== null,
      tooLate: screen.queryByText("Too late to ship") !== null,
      heldGifts: screen.queryByText(/waiting on an address/) !== null,
      learn: screen.queryByText(/we'll learn from it/) !== null,
    });
    const profile = () => getProfile.mockResolvedValueOnce({ groups: [], off: [], unread: 0, openCount: 0, readiness });

    it("shows them with access (AC-9)", async () => {
      getPerson.mockResolvedValue(late);
      profile();
      await show();
      expect(parts()).toEqual({ readiness: true, ideas: true, orderBy: true, tooLate: true, heldGifts: true, learn: true });
      expect(screen.queryByText(REMINDERS)).toBeNull();
    });

    it.each([
      ["without access", { access: false, requested: false }, true, false],
      // Money: where a held gift would ship is hidden only when there's surely none.
      ["when the check fails, but for where held gifts ship", null, false, true],
    ])("hides them, and shows the rest, %s (AC-19)", async (_, access, note, heldGifts) => {
      readAccess.mockResolvedValue(access);
      getPerson.mockResolvedValue(late);
      profile();
      await show();
      expect(parts()).toEqual({ readiness: false, ideas: false, orderBy: false, tooLate: false, heldGifts, learn: false });
      expect(screen.queryByText(REMINDERS) !== null).toBe(note);
      expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
        "Does Dad have a GiftsAF list?",
        "What we know",
        "Occasions",
        "Gifts",
      ]);
      expect(screen.getByText(/^Nothing yet/)).toHaveTextContent("Capture a page about Dad with the extension.");
      expect(screen.getByText("Fri, Dec 25")).toBeInTheDocument();
      expect(screen.getByRole("switch", { name: "Birthday" })).toBeChecked();
      for (const name of [/^About Dad/, /^Budget/, /^Saved gifts/, /^Shipping address/]) expect(screen.getByRole("link", { name })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete Dad" })).toBeInTheDocument();
    });
  });

  it("notes a photo that failed to save", async () => {
    getPerson.mockResolvedValue(dad);
    await show(true);
    expect(screen.getByRole("status")).toHaveTextContent("The photo didn't save. Try again.");
  });
});
