import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListCard } from "../list-card";

const TOKEN = "11111111-2222-4333-8444-555555555555";
const NOTICE = "If a gift for them is waiting on an address, it will ship to this list's owner.";
const SHARED_LINE = "Gifts not yet ordered won't ship to their address.";

type Result = { ok: true } | { ok: false; error: string };

function setup(
  props: Partial<Parameters<typeof ListCard>[0]> = {},
  results: { link?: Result | Error; unlink?: Result } = {},
) {
  const linkAction = vi.fn(async (token: string, personId: string): Promise<Result> => {
    void token;
    void personId;
    const r = results.link ?? ({ ok: true } as const);
    if (r instanceof Error) throw r;
    return r;
  });
  const unlinkAction = vi.fn(
    async (token: string, personId: string): Promise<Result> => (void token, void personId, results.unlink ?? { ok: true }),
  );
  render(
    <ListCard
      state="add"
      token={TOKEN}
      displayName="Sam"
      season={null}
      candidates={[]}
      linked={null}
      linkAction={linkAction}
      unlinkAction={unlinkAction}
      {...props}
    />,
  );
  return { linkAction, unlinkAction };
}

describe("ListCard signed out", () => {
  it("sends Add to sign-up and Sign in to the login page, both coming back to this list (AC-2)", () => {
    setup({ state: "signed-out" });
    const next = `next=${encodeURIComponent(`/share/${TOKEN}`)}`;
    expect(screen.getByRole("link", { name: "Add Sam to your people" })).toHaveAttribute("href", `/auth/sign-up?${next}`);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/auth/login?${next}`);
  });

  it("asks nobody to request access, or for an invite (AC-2)", () => {
    setup({ state: "signed-out" });
    expect(screen.queryByText(/request access|invite/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("leads with what the box is for, above the button (ALL-179)", () => {
    setup({ state: "signed-out" });
    const line = screen.getByText("Keep Sam's list, and make your own. Free.");
    const button = screen.getByRole("link", { name: "Add Sam to your people" });
    expect(line.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says this list when the owner has no name (ALL-179)", () => {
    setup({ state: "signed-out", displayName: null });
    expect(screen.getByText("Keep this list, and make your own. Free.")).toBeInTheDocument();
  });

  it("says them when the owner has no name", () => {
    setup({ state: "signed-out", displayName: null });
    expect(screen.getByRole("link", { name: "Add them to your people" })).toBeInTheDocument();
  });
});

describe("ListCard signed out, in season", () => {
  it("leads with the season's list, then keeping theirs, above the button (AC-2)", () => {
    setup({ state: "signed-out", season: "Christmas" });
    const lead = screen.getByText("Make your Christmas list. Free.");
    const keep = screen.getByText("Keep Sam's list too.");
    const button = screen.getByRole("link", { name: "Add Sam to your people" });
    expect(lead.compareDocumentPosition(keep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(keep.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("Keep Sam's list, and make your own. Free.")).not.toBeInTheDocument();
  });

  it("says this list when the owner has no name (AC-2)", () => {
    setup({ state: "signed-out", season: "Christmas", displayName: null });
    expect(screen.getByText("Keep this list too.")).toBeInTheDocument();
  });

  it("takes the season's name from the setting, not the code (AC-2, T23)", () => {
    setup({ state: "signed-out", season: "Hanukkah" });
    expect(screen.getByText("Make your Hanukkah list. Free.")).toBeInTheDocument();
  });

  it("still sends sign-up and sign-in back to this list (AC-2)", () => {
    setup({ state: "signed-out", season: "Christmas" });
    const next = `next=${encodeURIComponent(`/share/${TOKEN}`)}`;
    expect(screen.getByRole("link", { name: "Add Sam to your people" })).toHaveAttribute("href", `/auth/sign-up?${next}`);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/auth/login?${next}`);
  });
});

describe("ListCard signed in", () => {
  it("shows no season wording once signed in (AC-3)", () => {
    setup({ state: "add", season: "Christmas" });
    expect(screen.queryByText(/Christmas/)).not.toBeInTheDocument();
  });
});

describe("ListCard add", () => {
  it("links to the person form with this list (AC-6)", () => {
    setup();
    expect(screen.getByRole("link", { name: "Add Sam to your people" })).toHaveAttribute("href", `/people/new?list=${TOKEN}`);
  });

  it("says them when the owner has no name", () => {
    setup({ displayName: null });
    expect(screen.getByRole("link", { name: "Add them to your people" })).toBeInTheDocument();
  });

  it("hides the picker when there's nobody to link (Review 4)", () => {
    setup({ candidates: [] });
    expect(screen.queryByText("Already in your people? Link to…")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows the picker with each unlinked person (AC-6)", () => {
    setup({ candidates: [{ id: "p1", name: "Mom" }, { id: "p2", name: "Dad" }] });
    const picker = screen.getByLabelText("Already in your people? Link to…");
    expect(within(picker).getByRole("option", { name: "Mom" })).toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: "Dad" })).toBeInTheDocument();
  });

  it("says where a waiting gift will ship, with or without the picker (AC-19)", () => {
    setup();
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
  });

  it("links nobody until a person is picked", async () => {
    const { linkAction } = setup({ candidates: [{ id: "p1", name: "Mom" }] });
    expect(screen.getByRole("button", { name: "Link" })).toBeDisabled();
    expect(linkAction).not.toHaveBeenCalled();
  });

  it("picking and confirming links that person to this list (AC-10)", async () => {
    const { linkAction } = setup({ candidates: [{ id: "p1", name: "Mom" }, { id: "p2", name: "Dad" }] });
    await userEvent.selectOptions(screen.getByLabelText("Already in your people? Link to…"), "p2");
    await userEvent.click(screen.getByRole("button", { name: "Link" }));
    await waitFor(() => expect(linkAction).toHaveBeenCalledWith(TOKEN, "p2"));
  });

  it("shows the error copy when the link is refused (AC-20)", async () => {
    setup({ candidates: [{ id: "p1", name: "Mom" }] }, { link: { ok: false, error: "Mom already has a list linked." } });
    await userEvent.selectOptions(screen.getByLabelText("Already in your people? Link to…"), "p1");
    await userEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Mom already has a list linked.");
  });

  it("shows a plain error when the action fails outright (Review 2)", async () => {
    setup({ candidates: [{ id: "p1", name: "Mom" }] }, { link: new Error("boom") });
    await userEvent.selectOptions(screen.getByLabelText("Already in your people? Link to…"), "p1");
    await userEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't save. Try again.");
  });
});

describe("ListCard linked", () => {
  const mom = { id: "p1", name: "Mom", sharedAddress: false };

  it("names the linked person and links to their page (AC-10)", () => {
    setup({ state: "linked", linked: mom });
    // The name is a link inside the sentence, so match the whole line.
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Mom is in your people")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mom" })).toHaveAttribute("href", "/people/p1");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("Remove asks first, and Cancel changes nothing (AC-11)", async () => {
    const { unlinkAction } = setup({ state: "linked", linked: mom });
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Unlink Mom's list?")).toBeInTheDocument();
    expect(screen.getByText("Mom stays in your people with their occasions, budgets and saved gifts.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Unlink Mom's list?")).not.toBeInTheDocument());
    expect(unlinkAction).not.toHaveBeenCalled();
  });

  it("Confirm unlinks the person from this list (AC-12)", async () => {
    const { unlinkAction } = setup({ state: "linked", linked: mom });
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(await screen.findByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(unlinkAction).toHaveBeenCalledWith(TOKEN, "p1"));
  });

  it("shows an unlink error in the confirm", async () => {
    setup({ state: "linked", linked: mom }, { unlink: { ok: false, error: "That didn't save. Try again." } });
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(await screen.findByRole("button", { name: "Unlink" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't save. Try again.");
  });

  it("leaves out the address line when their address isn't the shared one (AC-22)", async () => {
    setup({ state: "linked", linked: mom });
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByText("Unlink Mom's list?");
    expect(screen.queryByText(SHARED_LINE)).not.toBeInTheDocument();
  });

  it("warns that gifts won't ship to the shared address (AC-22)", async () => {
    setup({ state: "linked", linked: { ...mom, sharedAddress: true } });
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText(SHARED_LINE)).toBeInTheDocument();
  });
});
