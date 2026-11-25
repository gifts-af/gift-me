import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GiftClaim, SharedGift, SharedList as SharedListData } from "@/modules/lists/lib/lists";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/modules/lists/actions/claims", () => ({ claimGift: vi.fn(), unclaimGift: vi.fn() }));
const { claimGift } = await import("@/modules/lists/actions/claims");
const { default: SharedList } = await import("../shared-list");

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
});

const item = (id: string, name: string, claim: GiftClaim | null = null): SharedGift => ({
  id,
  name,
  priceCents: 3200,
  imageUrl: null,
  productUrl: null,
  asin: null,
  source: "manual",
  addedAt: 0,
  claim,
});

const guest: SharedListData["viewer"] = { signedIn: false, name: null };
const mine: GiftClaim = { name: "Jordan", mine: true };

function renderList(opts: { viewer?: SharedListData["viewer"]; ownerName?: string | null } = {}) {
  const ownerName = opts.ownerName === undefined ? "Sam" : opts.ownerName;
  return render(
    <SharedList
      token="tok"
      list={{
        title: "t",
        cardEnabled: true,
        ownerName,
        linkedPerson: null,
        isOwner: false,
        viewer: opts.viewer ?? guest,
        items: [item("a", "Kettle"), item("b", "Socks")],
      }}
    />,
  );
}

async function claimAs(giftName: string, guestName?: string) {
  await userEvent.click(screen.getByRole("button", { name: `Claim ${giftName}` }));
  const dialog = screen.getByRole("dialog");
  if (guestName) await userEvent.type(within(dialog).getByLabelText(/Your name/), guestName);
  await userEvent.click(within(dialog).getByRole("button", { name: "Claim gift" }));
  return dialog;
}

beforeEach(() => {
  vi.mocked(claimGift).mockReset();
  window.localStorage.clear();
});

describe("claim offer", () => {
  it("after a guest claim, offers their own list and keeps the gift claimed", async () => {
    vi.mocked(claimGift).mockResolvedValue({ ok: true, claim: mine });
    renderList();
    const dialog = within(await claimAs("Kettle", "Jordan"));
    const heading = await dialog.findByRole("heading", { name: "Claimed. Sam won't see it." });
    expect(heading).toHaveFocus();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-labelledby", heading.id);
    expect(dialog.getByText("Want your own list for the family?")).toBeInTheDocument();
    expect(dialog.getByRole("link", { name: "Start yours, free" })).toHaveAttribute("href", "/auth/sign-up?next=%2Flists");
    expect(dialog.getByText("Your claim stays a guest claim, so it can't be undone.")).toBeInTheDocument();
    expect(screen.getAllByText("Claimed by you").length).toBeGreaterThan(0);
  });

  it("names nobody when the owner has no shown name", async () => {
    vi.mocked(claimGift).mockResolvedValue({ ok: true, claim: mine });
    renderList({ ownerName: null });
    const dialog = within(await claimAs("Kettle", "Jordan"));
    expect(await dialog.findByRole("heading", { name: "Claimed. They won't see it." })).toBeInTheDocument();
  });

  it("Not now closes it, and is remembered for the rest of the visit", async () => {
    vi.mocked(claimGift).mockResolvedValue({ ok: true, claim: mine });
    renderList();
    const first = within(await claimAs("Kettle", "Jordan"));
    await userEvent.click(await first.findByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Claimed by you")).toBeInTheDocument();

    await claimAs("Socks");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByText("Claimed by you")).toHaveLength(2);
  });

  it("offers again after every guest claim if they only closed it with Esc", async () => {
    vi.mocked(claimGift).mockResolvedValue({ ok: true, claim: mine });
    renderList();
    const first = within(await claimAs("Kettle", "Jordan"));
    await first.findByRole("heading", { name: /Claimed\./ });
    screen.getByRole("dialog").dispatchEvent(new Event("close"));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const second = within(await claimAs("Socks"));
    expect(await second.findByRole("heading", { name: "Claimed. Sam won't see it." })).toBeInTheDocument();
  });

  it("closes as before for a signed-in claim", async () => {
    vi.mocked(claimGift).mockResolvedValue({ ok: true, claim: mine });
    renderList({ viewer: { signedIn: true, name: "Jordan" } });
    await userEvent.click(screen.getByRole("button", { name: "Claim Kettle" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Claim gift" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("Want your own list for the family?")).not.toBeInTheDocument();
  });

  it("shows no offer when the claim fails", async () => {
    vi.mocked(claimGift).mockResolvedValue({ ok: false, error: "Nope." });
    renderList();
    const dialog = within(await claimAs("Kettle", "Jordan"));
    expect(await dialog.findByText("Nope.")).toBeInTheDocument();
    expect(dialog.queryByText("Want your own list for the family?")).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Claim gift" })).toBeInTheDocument();
  });
});
