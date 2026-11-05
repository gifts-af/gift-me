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
  fetchMock = vi.fn(async () => json({ id: "c1" }, 201));
  vi.stubGlobal("fetch", fetchMock);
  document.title = "Stoneware mug set";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
    expect(await screen.findByText("Capture for…")).toBeInTheDocument();
    const mom = await screen.findByRole("button", { name: "Mom" });
    expect(screen.getByRole("button", { name: "Dad" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await userEvent.click(mom);
    expect(mom).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Dad" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Save to Mom" })).toBeEnabled();
  });

  const NOTICE = "Alpha: we read each capture with AI, which spends real money, about 2¢ each.";

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
    expect(
      await screen.findByText("Saved to Mom. Reading captures spends real money, so during alpha it's only on for test accounts."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/learn from it later/)).not.toBeInTheDocument();
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

  it("only probes the page on open; nothing is collected until Save", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Mom" });
    await waitFor(() => expect(fake.scripting.calls).toHaveLength(1));
    expect(fake.scripting.calls[0].args).toBeUndefined();
    expect(fake.tabs.captures).toHaveLength(0);
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

    expect(await screen.findByText("Saved to Mom. We'll show you what we learned.")).toBeInTheDocument();
    const form = sentForm();
    expect(form.get("person_id")).toBe("p-mom");
    expect(form.get("note")).toBe("She loved this");
    expect(form.get("title")).toBe("Stoneware mug set");
    expect(fake.tabs.captures).toEqual([{ format: "jpeg", quality: 80 }]);
    expect(fake.scripting.calls[1].args).toEqual([50_000]);

    await userEvent.click(screen.getByRole("button", { name: "Capture another" }));
    expect(screen.getByLabelText(/Note/)).toHaveValue("");
    expect(screen.getByRole("button", { name: "Mom" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Dad" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("a blank note is left out", async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Mom" }));
    await userEvent.type(screen.getByLabelText(/Note/), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Save to Mom" }));
    await screen.findByText(/Saved to Mom/);
    expect(sentForm().has("note")).toBe(false);
  });

  it("an upload failure shows an inline error; Try again resends the same capture", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Couldn't save the capture." }, 500));
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Mom" }));
    await userEvent.click(screen.getByRole("button", { name: "Save to Mom" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the capture.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText(/Saved to Mom/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentForm(1).get("person_id")).toBe("p-mom");
    expect(sentForm(1).get("screenshot")).toEqual(sentForm(0).get("screenshot"));
    // Collected once: one probe plus one collection, one screenshot.
    expect(fake.scripting.calls).toHaveLength(2);
    expect(fake.tabs.captures).toHaveLength(1);
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
    expect(await screen.findByText("Here's what I learned about Mom")).toBeInTheDocument();
  });

  it("lists what was learned, owned things as Already has, and links to the person", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "c1", extraction: { status: "extracted", facts } }, 201));
    await capture();
    expect(await screen.findByText("Here's what I learned about Mom")).toBeInTheDocument();
    expect(screen.getByText("Wants: a ceramic pour-over set")).toBeInTheDocument();
    expect(screen.getByText("Already has: Owala water bottle")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "See everything about Mom →" });
    expect(link).toHaveAttribute("href", "https://app.test/people/p-mom");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("says so honestly when nothing confident was found", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "c1", extraction: { status: "extracted", facts: [] } }, 201));
    await capture();
    expect(await screen.findByText("Nothing new to learn from this page. The capture is saved.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See everything about Mom →" })).toBeInTheDocument();
  });

  it("a failed read offers Try again, which retries the read, not the upload", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: "c1", extraction: { status: "failed", facts: [] } }, 201))
      .mockResolvedValueOnce(json({ extraction: { status: "extracted", facts } }, 200));
    await capture();
    expect(await screen.findByText("Couldn't read this page. The capture is saved.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Wants: a ceramic pour-over set")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe("https://app.test/api/captures/c1/extract");
  });

  it("with reading switched off, says it'll learn later", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "c1", extraction: { status: "pending", facts: [] } }, 201));
    await capture();
    expect(await screen.findByText("Saved. We'll learn from it later.")).toBeInTheDocument();
  });
});

