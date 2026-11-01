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
  session: { access_token: "tok" } as { access_token: string } | null,
  people: [] as Person[],
  peopleError: null as { message: string } | null,
  textMax: 50_000 as number | null,
  screenshotMax: 2_500_000 as number | null,
  inserts: [] as unknown[],
};
const client = {
  auth: { getSession: vi.fn(async () => ({ data: { session: db.session }, error: null })) },
  from: vi.fn(() => ({
    select: () => ({
      order: async () => ({ data: db.peopleError ? null : db.people, error: db.peopleError }),
    }),
    insert: (row: { name: string; relationship: string }) => {
      db.inserts.push(row);
      return {
        select: () => ({
          single: async () => ({ data: { id: `new-${row.name}`, name: row.name }, error: null }),
        }),
      };
    },
  })),
  schema: vi.fn(() => ({
    rpc: vi.fn(async (_fn: string, args: { p_key: string }) => {
      const value =
        args.p_key === "capture_text_max_chars"
          ? db.textMax
          : args.p_key === "capture_screenshot_max_bytes"
            ? db.screenshotMax
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
  db.session = { access_token: "tok" };
  db.people = [
    { id: "p-dad", name: "Dad" },
    { id: "p-mom", name: "Mom" },
  ];
  db.peopleError = null;
  db.textMax = 50_000;
  db.screenshotMax = 2_500_000;
  db.inserts = [];
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

  it("no people: shows the add form; adding Sam (friend) inserts and selects Sam (AC-9)", async () => {
    db.people = [];
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Name"), "Sam");
    await userEvent.selectOptions(screen.getByLabelText("Relationship"), "friend");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(db.inserts).toEqual([{ name: "Sam", relationship: "friend" }]);
    expect(await screen.findByRole("button", { name: "Save to Sam" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sam" })).toHaveAttribute("aria-pressed", "true");
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
