// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFakeChrome, type FakeChrome } from "../../test/fake-chrome";
import { App } from "../App";

vi.mock("../../lib/config", () => ({
  config: { appOrigin: "https://app.test", supabaseUrl: "https://sb.test", supabaseKey: "key", jpegQuality: 80 },
}));

const signOut = vi.fn(async () => {});
vi.mock("../../lib/auth", () => ({ signOut: () => signOut() }));

// A small stand-in for the supabase-js client: just the calls the popup makes.
type Person = { id: string; name: string };
const db = {
  session: { access_token: "tok", user: { id: "u1" } } as { access_token: string; user: { id: string } } | null,
  people: [] as Person[],
  peopleError: null as { message: string } | null,
  textMax: 50_000 as number | null,
  screenshotMax: 2_500_000 as number | null,
  readEstimate: 2 as number | null,
  paidFeatures: true as boolean | null,
  checkedUser: null as string | null,
  adds: [] as unknown[],
  recent: [] as { person_id: string }[],
};
const client = {
  auth: { getSession: vi.fn(async () => ({ data: { session: db.session }, error: null })) },
  from: vi.fn(() => ({
    select: () => ({
      order: async () => ({ data: db.peopleError ? null : db.people, error: db.peopleError }),
    }),
  })),
  schema: vi.fn(() => ({
    rpc: vi.fn(async (fn: string, args: { p_key: string; p_name?: string; p_user_id?: string }) => {
      if (fn === "has_paid_features") {
        db.checkedUser = args.p_user_id ?? null;
        return db.paidFeatures === null
          ? { data: null, error: { message: "failed" } }
          : { data: db.paidFeatures, error: null };
      }
      if (fn === "recent_people") return { data: db.recent, error: null };
      if (fn === "add_person") {
        db.adds.push(args);
        return { data: `new-${args.p_name}`, error: null };
      }
      const value =
        args.p_key === "capture_text_max_chars"
          ? db.textMax
          : args.p_key === "capture_screenshot_max_bytes"
            ? db.screenshotMax
            : args.p_key === "capture_read_estimate_cents"
              ? db.readEstimate
              : args.p_key === "list_photo_width_px"
                ? 400
                : args.p_key === "list_photo_jpeg_quality"
                  ? 80
                  : null;
      return value === null ? { data: null, error: { message: "missing" } } : { data: value, error: null };
    }),
  })),
};
vi.mock("../../lib/supabase", () => ({ getSupabase: () => client }));

let fake: FakeChrome;
let fetchMock: ReturnType<typeof vi.fn>;
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  fake = installFakeChrome();
  db.session = { access_token: "tok", user: { id: "u1" } };
  db.people = [
    { id: "p-dad", name: "Dad" },
    { id: "p-mom", name: "Mom" },
  ];
  db.peopleError = null;
  db.textMax = 50_000;
  db.screenshotMax = 2_500_000;
  db.readEstimate = 2;
  db.paidFeatures = true;
  db.checkedUser = null;
  db.adds = [];
  db.recent = [];
  fetchMock = vi.fn(async () => json({ id: "c1" }, 201));
  vi.stubGlobal("fetch", fetchMock);
  document.title = "Stoneware mug set";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

function sentForm(call = 0): FormData {
  return (fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1].body as FormData;
}

describe("Popup", () => {
  it("signed out: Sign in opens the connect page", async () => {
    db.session = null;
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(fake.tabs.created).toEqual([{ url: "https://app.test/extension/connect" }]);
    expect(fake.scripting.calls).toHaveLength(0);
  });

  it("lists people by name; picking one makes the button read Save to Mom", async () => {
    render(<App />);
    expect(
      await screen.findByText("No product on this page, so there's nothing to add to your list. You can still save it for someone."),
    ).toBeInTheDocument();
    expect(screen.getByText("GiftsAF")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to my list" })).not.toBeInTheDocument();
    const mom = await screen.findByRole("button", { name: "Mom" });
    expect(screen.getByRole("button", { name: "Dad" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await userEvent.click(mom);
    expect(mom).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Dad" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Save to Mom" })).toBeEnabled();
  });

  const NOTICE = "We read each capture with AI, which costs real money: about 2¢ each.";

  it("with paid features, shows the money notice before saving (ALL-94)", async () => {
    render(<App />);
    expect(await screen.findByRole("note")).toHaveTextContent(NOTICE);
    expect(db.checkedUser).toBe("u1");
  });

  it("without paid features, shows no notice and says why after saving (ALL-94)", async () => {
    db.paidFeatures = false;
    fetchMock.mockResolvedValueOnce(json({ id: "c1", extraction: { status: "pending", facts: [] } }, 201));
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Mom" }));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save to Mom" }));
    expect(await screen.findByRole("note")).toHaveTextContent("Not read yet");
    expect(screen.getByRole("status")).toHaveTextContent("Saved to Mom");
    expect(screen.queryByText(/read it shortly/)).not.toBeInTheDocument();
  });

  it.each([
    ["the flag", () => (db.paidFeatures = null)],
    ["the estimate", () => (db.readEstimate = null)],
  ])("shows the load error when %s can't be read (ALL-94)", async (_what, breakIt) => {
    breakIt();
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("search narrows the list by name", async () => {
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Search people"), "mo");
    expect(screen.getByRole("button", { name: "Mom" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dad" })).not.toBeInTheDocument();
  });

  it("on open, reads only the product fragments in one script; the page text is collected only on Save", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Mom" });
    await waitFor(() => expect(fake.tabs.captures).toHaveLength(1));
    expect(fake.scripting.calls).toHaveLength(1);
    expect(fake.scripting.calls[0].args).toBeUndefined();
    expect(fake.tabs.captures).toEqual([{ format: "png" }]);
  });

  it("no people: shows the add form; adding Sam (friend) saves through add_person and selects Sam (AC-9)", async () => {
    db.people = [];
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Name"), "Sam");
    await userEvent.selectOptions(screen.getByLabelText("Relationship"), "friend");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(db.adds).toEqual([{ p_name: "Sam", p_relationship: "friend", p_kinds: ["christmas"] }]);
    expect(await screen.findByRole("button", { name: "Save to Sam" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sam" })).toHaveAttribute("aria-pressed", "true");
  });

  it("adding a mother also starts Mother's Day", async () => {
    db.people = [];
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Name"), "Mom2");
    await userEvent.selectOptions(screen.getByLabelText("Relationship"), "mother");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByRole("button", { name: "Save to Mom2" });
    const args = db.adds[0] as { p_kinds: string[] };
    expect(args.p_kinds).toEqual(expect.arrayContaining(["christmas", "mothers_day"]));
  });

  // ALL-121: the in-laws are in the quick add too, labelled with hyphens.
  it("offers the in-laws, and a mother-in-law starts Mother's Day", async () => {
    db.people = [];
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Name"), "Linda");
    await userEvent.selectOptions(screen.getByLabelText("Relationship"), screen.getByRole("option", { name: "Mother-in-law" }));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByRole("button", { name: "Save to Linda" });
    expect(db.adds[0]).toMatchObject({ p_relationship: "mother_in_law" });
    expect((db.adds[0] as { p_kinds: string[] }).p_kinds).toContain("mothers_day");
  });

  it("with people: Add a person opens the same form", async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a person" }));
    expect(screen.getByLabelText("Name")).toHaveAttribute("maxlength", "120");
  });

  it("a blocked page says it can't be captured and keeps Save disabled (AC-10)", async () => {
    fake.scripting.blocked = true;
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Mom" }));
    expect(await screen.findByText("This page can't be captured.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save to Mom" })).toBeDisabled();
  });

  it("a missing text cap shows a generic error rather than guessing a default", async () => {
    db.textMax = null;
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.queryByRole("button", { name: /^Save/ })).not.toBeInTheDocument();
  });

  it("a missing screenshot cap shows a generic error rather than guessing a default", async () => {
    db.screenshotMax = null;
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.queryByRole("button", { name: /^Save/ })).not.toBeInTheDocument();
  });

  it("a screenshot that can't be shrunk under the cap says the page is too large and sends nothing", async () => {
    // The fake screenshot is 3 bytes. jsdom has no canvas, so these stand-ins
    // make every re-encode still too big.
    db.screenshotMax = 2;
    vi.stubGlobal("createImageBitmap", async () => ({ width: 100, height: 100, close() {} }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage() {} };
        }
        async convertToBlob() {
          return new Blob([new Uint8Array(3)], { type: "image/jpeg" });
        }
      },
    );
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Mom" }));
    await userEvent.click(screen.getByRole("button", { name: "Save to Mom" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This page is too large to capture.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves, confirms, and Capture another resets the form", async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Mom" }));
    await userEvent.type(screen.getByLabelText(/Note/), "She loved this");
    await userEvent.click(screen.getByRole("button", { name: "Save to Mom" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Saved to Mom");
    expect(screen.getByText("Capture for…")).toBeInTheDocument();
    const form = sentForm();
    expect(form.get("person_id")).toBe("p-mom");
    expect(form.get("note")).toBe("She loved this");
    expect(form.get("title")).toBe("Stoneware mug set");
    expect(fake.tabs.captures[1]).toEqual({ format: "jpeg", quality: 80 });
    expect(fake.scripting.calls[1].args).toEqual([50_000]);

    await userEvent.click(screen.getByRole("button", { name: "Capture another" }));
    expect(await screen.findByLabelText(/Note/)).toHaveValue("");
    expect(screen.getByRole("button", { name: "Mom" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Dad" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("a blank note is left out", async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Mom" }));
    await userEvent.type(screen.getByLabelText(/Note/), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Save to Mom" }));
    await screen.findByRole("link", { name: "See Mom's profile" });
    expect(sentForm().has("note")).toBe(false);
  });

  it("an upload failure shows an inline error; Try again resends the same capture", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Couldn't save the capture." }, 500));
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Mom" }));
    await userEvent.click(screen.getByRole("button", { name: "Save to Mom" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the capture.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("link", { name: "See Mom's profile" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentForm(1).get("person_id")).toBe("p-mom");
    expect(sentForm(1).get("screenshot")).toEqual(sentForm(0).get("screenshot"));
    // Collected once: one probe plus one collection, one screenshot.
    expect(fake.scripting.calls).toHaveLength(2);
    expect(fake.tabs.captures).toHaveLength(2);
  });

  it("a 401 goes back to Sign in", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Sign in again." }, 401));
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Mom" }));
    await userEvent.click(screen.getByRole("button", { name: "Save to Mom" }));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("Sign out signs out locally and shows Sign in (AC-3)", async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});

describe("Here's what I learned (ALL-25)", () => {
  async function capture() {
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Mom" }));
    await userEvent.click(screen.getByRole("button", { name: "Save to Mom" }));
  }
  const facts = [
    { id: "f1", category: "wants", value: "a ceramic pour-over set" },
    { id: "f2", category: "owns", value: "Owala water bottle" },
  ];

  it("says it's reading the page while it waits", async () => {
    let answer: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)));
    await capture();
    expect(await screen.findByText("Reading the page…")).toBeInTheDocument();
    answer(json({ id: "c1", extraction: { status: "extracted", facts } }, 201));
    expect(await screen.findByText("Here's what I learned")).toBeInTheDocument();
  });

  it("lists what was learned, owned things as Already has, and links to the person", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "c1", extraction: { status: "extracted", facts } }, 201));
    await capture();
    expect(await screen.findByText("Here's what I learned")).toBeInTheDocument();
    expect(screen.getByText("Wants: a ceramic pour-over set")).toBeInTheDocument();
    expect(screen.getByText("Already has: Owala water bottle")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "See Mom's profile" });
    expect(link).toHaveAttribute("href", "https://app.test/people/p-mom");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("says so honestly when nothing confident was found", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "c1", extraction: { status: "extracted", facts: [] } }, 201));
    await capture();
    expect(await screen.findByText("Nothing new to learn from this page. It's kept on Mom's profile.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See Mom's profile" })).toBeInTheDocument();
  });

  it("a failed read offers Try again, which retries the read, not the upload", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: "c1", extraction: { status: "failed", facts: [] } }, 201))
      .mockResolvedValueOnce(json({ extraction: { status: "extracted", facts } }, 200));
    await capture();
    expect(await screen.findByText("We couldn't read this page.")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("about 2¢ each"); // Trying again spends money too (ALL-94).
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Wants: a ceramic pour-over set")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe("https://app.test/api/captures/c1/extract");
  });

  it("with reading switched off, says it'll learn later", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "c1", extraction: { status: "pending", facts: [] } }, 201));
    await capture();
    expect(await screen.findByText("We'll read it shortly. What we learn shows on Mom's profile.")).toBeInTheDocument();
  });
});


describe("Product page (ALL-78)", () => {
  // What cropPhoto drew: the source rectangle of each crop.
  let drawn: number[][];

  function productPage({ price = "35.00" as string | null } = {}) {
    const product = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: "YETI Rambler 20 oz Tumbler",
      image: "https://img.rei.com/main.jpg",
      sku: "SKU-1",
      ...(price === null ? {} : { offers: { "@type": "Offer", price, priceCurrency: "USD" } }),
    };
    document.head.innerHTML = `<script type="application/ld+json">${JSON.stringify(product)}</script>`;
    document.body.innerHTML = "";
    // Two large images on screen: a big banner and the (smaller) product image.
    const boxes: [string, DOMRect][] = [
      ["https://img.rei.com/banner.jpg", { left: 0, top: 0, right: 600, bottom: 300, width: 600, height: 300 } as DOMRect],
      ["https://img.rei.com/main.jpg", { left: 100, top: 320, right: 300, bottom: 520, width: 200, height: 200 } as DOMRect],
    ];
    for (const [src, rect] of boxes) {
      const img = document.createElement("img");
      img.src = src;
      img.getBoundingClientRect = () => rect;
      document.body.append(img);
    }
  }

  beforeEach(() => {
    drawn = [];
    // jsdom has no image decoding or canvas: the screenshot is 2048px wide
    // (innerWidth 1024, so scale 2), and the crop records what it drew.
    vi.stubGlobal("createImageBitmap", async () => ({ width: 2048, height: 1536, close() {} }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage: (_b: unknown, ...rect: number[]) => drawn.push(rect.slice(0, 4)) };
        }
        async convertToBlob() {
          return new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
        }
      },
    );
    URL.createObjectURL = vi.fn(() => "blob:shot");
    URL.revokeObjectURL = vi.fn();
    productPage();
  });

  const addButton = () => screen.findByRole("button", { name: "Add to my list" });

  it("shows the card, the recent people and Someone else…; nothing is sent before Add", async () => {
    render(<App />);
    await addButton();
    expect(screen.getByText("GiftsAF")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("YETI Rambler 20 oz Tumbler");
    expect(screen.getByLabelText("Price")).toHaveValue("$35.00");
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dad" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mom" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Someone else…" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Add sends the edited gift with the product photo, version 1, and shows Added", async () => {
    fetchMock.mockResolvedValueOnce(json({ outcome: "added", itemId: "i1" }, 201));
    render(<App />);
    await addButton();
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Rambler");
    await userEvent.clear(screen.getByLabelText("Price"));
    await userEvent.type(screen.getByLabelText("Price"), "30");
    await userEvent.click(screen.getByRole("button", { name: "Add to my list" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Added to your listRambler · $30.00");
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://app.test/api/lists/items");
    const form = sentForm();
    expect(form.get("v")).toBe("1");
    expect(form.get("name")).toBe("Rambler");
    expect(form.get("priceCents")).toBe("3000");
    expect(form.get("productId")).toBe("SKU-1");
    expect(form.get("pageUrl")).toBe(location.href);
    expect(form.get("photo")).toBeInstanceOf(Blob);
    // The product image's box (100,320 200×200) at scale 2.
    expect(drawn).toEqual([[200, 640, 400, 400]]);
    // One screenshot, taken when the popup opened.
    expect(fake.tabs.captures).toHaveLength(1);
  });

  it("› switches the photo, and the shown one is the one sent", async () => {
    fetchMock.mockResolvedValueOnce(json({ outcome: "added", itemId: "i1" }, 201));
    render(<App />);
    await addButton();
    await userEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add to my list" }));
    await screen.findByText("Added to your list");
    expect(drawn).toEqual([[0, 0, 1200, 600]]);
  });

  it("Done closes the popup", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(json({ outcome: "added", itemId: "i1" }, 201));
    render(<App />);
    await userEvent.click(await addButton());
    await userEvent.click(await screen.findByRole("button", { name: "Done" }));
    expect(close).toHaveBeenCalled();
    close.mockRestore();
  });

  it("already on the list says so", async () => {
    fetchMock.mockResolvedValueOnce(json({ outcome: "duplicate" }, 200));
    render(<App />);
    await userEvent.click(await addButton());
    expect(await screen.findByRole("status")).toHaveTextContent("Already on your list");
    expect(screen.getByText("This link is on your list already, so nothing was added twice.")).toBeInTheDocument();
  });

  it("a likely duplicate asks; Add anyway resends with confirmLikely", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ outcome: "likely", existing: { name: "Rambler", priceCents: 3000, imageUrl: null } }, 200))
      .mockResolvedValueOnce(json({ outcome: "added", itemId: "i1" }, 201));
    render(<App />);
    await userEvent.click(await addButton());
    expect(await screen.findByText("This looks like a gift already on your list")).toBeInTheDocument();
    expect(sentForm(0).has("confirmLikely")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Add anyway" }));
    expect(await screen.findByText("Added to your list")).toBeInTheDocument();
    expect(sentForm(1).get("confirmLikely")).toBe("1");
  });

  it("a likely duplicate: Don't add goes back to the card with the edits kept, and sends nothing more", async () => {
    fetchMock.mockResolvedValueOnce(json({ outcome: "likely", existing: { name: "Rambler", priceCents: 3000, imageUrl: null } }, 200));
    render(<App />);
    await addButton();
    await userEvent.type(screen.getByLabelText("Name"), " Blue");
    await userEvent.click(screen.getByRole("button", { name: "Add to my list" }));
    await userEvent.click(await screen.findByRole("button", { name: "Don't add" }));
    expect(screen.getByLabelText("Name")).toHaveValue("YETI Rambler 20 oz Tumbler Blue");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a full list says so", async () => {
    fetchMock.mockResolvedValueOnce(json({ outcome: "full" }, 200));
    render(<App />);
    await userEvent.click(await addButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Your list is full");
  });

  it("a 401 on Add shows sign-in (AC-18)", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Sign in again." }, 401));
    render(<App />);
    await userEvent.click(await addButton());
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("no session on Add shows sign-in (AC-18)", async () => {
    render(<App />);
    const add = await addButton();
    db.session = null;
    await userEvent.click(add);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([404, 503])("a %i on Add says adding is paused, and the card stays (AC-20)", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response("off", { status }));
    render(<App />);
    await userEvent.click(await addButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Adding from the extension is paused");
    expect(screen.getByRole("button", { name: "Add to my list" })).toBeEnabled();
  });

  it("no price: the box is empty and focused, and Add is off", async () => {
    productPage({ price: null });
    render(<App />);
    expect(await addButton()).toBeDisabled();
    expect(screen.getByLabelText("Price")).toHaveValue("");
    expect(screen.getByLabelText("Price")).toHaveFocus();
    expect(screen.getByText("Not on the page. Type it in.")).toBeInTheDocument();
  });

  it("Someone else… opens the full list with Back; Back keeps the card's edits (AC-13)", async () => {
    render(<App />);
    await addButton();
    await userEvent.type(screen.getByLabelText("Name"), " Blue");
    await userEvent.click(screen.getByRole("button", { name: "Next photo" }));
    await userEvent.click(screen.getByRole("button", { name: "Someone else…" }));

    expect(screen.getByText("Save for someone")).toBeInTheDocument();
    expect(screen.getByLabelText("Search people")).toHaveFocus();
    expect(screen.getByText("YETI Rambler 20 oz Tumbler Blue")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to my list" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "‹ Back" }));
    expect(screen.getByLabelText("Name")).toHaveValue("YETI Rambler 20 oz Tumbler Blue");
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
  });

  it("Someone else… then Save saves for that person", async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Someone else…" }));
    await userEvent.click(screen.getByRole("button", { name: "Mom" }));
    await userEvent.click(screen.getByRole("button", { name: "Save to Mom" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved to Mom");
    expect(sentForm().get("person_id")).toBe("p-mom");
  });

  it("a recent person opens the full list with them picked; nothing is saved until Save", async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Dad" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Save for someone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "‹ Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Dad/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.type(screen.getByLabelText("Note (optional)"), "His size");
    await userEvent.click(screen.getByRole("button", { name: "Save to Dad" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved to Dad");
    expect(sentForm().get("person_id")).toBe("p-dad");
    expect(sentForm().get("note")).toBe("His size");
  });

  it("only people from recent_people are tagged recent, not the alphabetical fill-ins", async () => {
    db.people = [
      { id: "p-ann", name: "Ann" },
      { id: "p-dad", name: "Dad" },
      { id: "p-mom", name: "Mom" },
      { id: "p-sam", name: "Sam" },
    ];
    db.recent = [{ person_id: "p-mom" }];
    render(<App />);
    const chips = (await screen.findByRole("button", { name: "Someone else…" })).parentElement!;
    expect(Array.from(chips.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Mom", "Ann", "Dad", "Someone else…"]);
    await userEvent.click(screen.getByRole("button", { name: "Someone else…" }));
    const list = screen.getByRole("list", { name: "People" });
    expect(Array.from(list.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Momrecent", "Ann", "Dad", "Sam"]);
  });
});
