import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SharedSize } from "@/lib/size-kinds";
import SizesPanel from "../sizes-panel";
import ViewDialog from "../view-dialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { default: ClaimDialog } = await import("../claim-dialog");

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
});

const sizes: SharedSize[] = [
  { kind: "shoe", value: "10.5" },
  { kind: "color", value: "Green" },
];

describe("SizesPanel (ALL-183 AC-5, AC-7)", () => {
  it("names the person and joins the items that fit", () => {
    render(<SizesPanel sizes={sizes} name="Aaron" giftName="Allbirds Wool Runners Sneakers" />);
    expect(screen.getByText("Aaron's sizes")).toBeInTheDocument();
    expect(screen.getByText("Shoe: 10.5 · Favorite color: Green")).toBeInTheDocument();
  });

  it("says Their sizes without a name", () => {
    render(<SizesPanel sizes={sizes} name={null} giftName="Sneakers" />);
    expect(screen.getByText("Their sizes")).toBeInTheDocument();
  });

  it("renders nothing for none", () => {
    const { container, rerender } = render(<SizesPanel sizes={[]} name="A" giftName="Sneakers" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<SizesPanel sizes={null} name="A" giftName="Sneakers" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the boxes show it", () => {
  const gift = { name: "Wool Runners Sneakers", productUrl: "https://www.target.com/p/x" };

  it("ViewDialog shows the panel", () => {
    render(<ViewDialog gift={gift} sizes={sizes} ownerName="Aaron" onClose={() => {}} />);
    expect(screen.getByText("Shoe: 10.5 · Favorite color: Green")).toBeInTheDocument();
  });

  it("ClaimDialog shows the panel under the gift name", () => {
    render(
      <ClaimDialog
        gift={gift}
        viewer={{ signedIn: false, name: null }}
        next="/share/t"
        onConfirm={vi.fn()}
        onClose={() => {}}
        sizes={sizes}
        ownerName="Aaron"
      />,
    );
    const name = screen.getByText("Wool Runners Sneakers");
    const panel = screen.getByText("Aaron's sizes");
    expect(name.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a box opened before the sizes arrived stays without a panel", () => {
    const { rerender } = render(<ViewDialog gift={gift} sizes={null} ownerName="Aaron" onClose={() => {}} />);
    rerender(<ViewDialog gift={gift} sizes={sizes} ownerName="Aaron" onClose={() => {}} />);
    expect(screen.queryByText("Aaron's sizes")).toBeNull();
  });

  it("a claim box opened before the sizes arrived stays without a panel", () => {
    const props = { gift, viewer: { signedIn: false, name: null }, next: "/share/t", onConfirm: vi.fn(), onClose: () => {}, ownerName: "Aaron" };
    const { rerender } = render(<ClaimDialog {...props} sizes={null} />);
    rerender(<ClaimDialog {...props} sizes={sizes} />);
    expect(screen.queryByText("Aaron's sizes")).toBeNull();
  });
});
