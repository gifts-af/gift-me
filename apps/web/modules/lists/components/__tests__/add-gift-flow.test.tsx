import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PageProduct } from "@gifts-af/core/store-page";
import type { AmazonLookupResult } from "@/modules/lists/lib/amazon-lookup";
import type { ReadPage } from "@/modules/lists/lib/gift-link";
import AddGiftPanel, { type AddGiftPanelProps } from "../add-gift-panel";

type LookUpAmazon = NonNullable<AddGiftPanelProps["lookUpAmazon"]>;

// A store page read that found a product, with only the fields these tests use.
function pageRead(product: Pick<PageProduct, "name" | "priceCents" | "imageUrl">): Awaited<ReturnType<ReadPage>> {
  return { ok: true, product: { isProduct: true, productId: null, canonicalUrl: null, ...product } };
}

async function lookUp(url: string) {
  const onAdd = vi.fn();
  render(<AddGiftPanel onAdd={onAdd} />);
  // Paste, as a person does: typing a long URL a key at a time made this the
  // slowest unit test file (ALL-117).
  await userEvent.click(screen.getByLabelText("Paste a link"));
  await userEvent.paste(url);
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  return onAdd;
}

describe("adding a gift", () => {
  it("adds a full match in one tap, clears the link and says so (AC-1)", async () => {
    const onAdd = await lookUp("https://www.amazon.com/dp/B07FZ8S74R");
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ priceCents: 3999, asin: "B07FZ8S74R", source: "amazon-fixture" }),
    );
    expect(screen.getByLabelText("Paste a link")).toHaveValue("");
    expect(screen.getByLabelText("Paste a link")).toHaveFocus();
    // Shown, not only announced, so a sighted person knows it's saved.
    expect(screen.getByText("Added Echo Dot (3rd Gen) Smart Speaker with Alexa - Charcoal to your list.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add to list" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Gift name")).not.toBeInTheDocument();
  });

  it("keeps a partial match's draft when another link is looked up (AC-3)", async () => {
    const onAdd = await lookUp("https://www.amazon.com/Wool-Hiking-Socks/dp/B0EXAMPLE1");
    await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
    await userEvent.type(screen.getByLabelText("Price"), "18");

    const field = screen.getByLabelText("Paste a link");
    await userEvent.clear(field);
    await userEvent.paste("https://www.amazon.com/dp/B07FZ8S74R");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Finish adding this one first, or tap Cancel.")).toBeVisible();
    expect(screen.getByLabelText("Gift name")).toHaveValue("Wool Hiking Socks");
    expect(screen.getByLabelText("Price")).toHaveValue("18");
    expect(onAdd).not.toHaveBeenCalled();

    // Cancel clears the draft and closes it; the next lookup goes ahead.
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Gift name")).not.toBeInTheDocument();
    await userEvent.click(field);
    await userEvent.paste("https://www.amazon.com/dp/B07FZ8S74R");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ asin: "B07FZ8S74R" })));
  });

  it("adds a partial match with Add to list, then clears the link (AC-2)", async () => {
    const onAdd = await lookUp("https://www.amazon.com/Wool-Hiking-Socks/dp/B0EXAMPLE1");
    await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
    expect(screen.getByLabelText("Paste a link")).toHaveValue("https://www.amazon.com/Wool-Hiking-Socks/dp/B0EXAMPLE1");
    await userEvent.type(screen.getByLabelText("Price"), "18");
    await userEvent.click(screen.getByRole("button", { name: "Add to list" }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: "Wool Hiking Socks", priceCents: 1800 }));
    expect(screen.getByLabelText("Paste a link")).toHaveValue("");
  });

  it("opens the details at the price when the link has no price", async () => {
    await lookUp("https://www.amazon.com/Wool-Hiking-Socks/dp/B0EXAMPLE1");
    await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
    expect(screen.getByLabelText("Gift name")).toHaveValue("Wool Hiking Socks");
  });

  it("keeps the link and says so when it can't be read", async () => {
    await lookUp("not a link");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Paste a link")).toHaveValue("not a link");
    expect(screen.getByLabelText("Paste a link")).toHaveFocus();
  });

  it("takes a Walmart link, fills the name, and waits for the price (ALL-10)", async () => {
    const onAdd = await lookUp("https://www.walmart.com/ip/Great-Value-Long-Grain-Enriched-Rice-32-oz/10315394");
    await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
    expect(screen.getByLabelText("Gift name")).toHaveValue("Great Value Long Grain Enriched Rice 32 Oz");
    expect(screen.getByText(/can’t read prices from/)).toHaveTextContent("walmart.com");
    await userEvent.type(screen.getByLabelText("Price"), "1.82");
    await userEvent.click(screen.getByRole("button", { name: "Add to list" }));
    expect(onAdd).toHaveBeenCalledWith({
      name: "Great Value Long Grain Enriched Rice 32 Oz",
      priceCents: 182,
      imageUrl: null,
      productUrl: "https://www.walmart.com/ip/Great-Value-Long-Grain-Enriched-Rice-32-oz/10315394",
      asin: null,
      source: "store-url",
    });
  });

  it("opens the details at the name when a store link has only an ID", async () => {
    await lookUp("https://www.walmart.com/ip/10315394");
    await waitFor(() => expect(screen.getByLabelText("Gift name")).toHaveFocus());
    expect(screen.getByLabelText("Gift name")).toHaveValue("");
  });

  it("checks the price when adding by hand", async () => {
    const onAdd = vi.fn();
    render(<AddGiftPanel onAdd={onAdd} />);
    await userEvent.click(screen.getByRole("button", { name: "Add by hand" }));
    await userEvent.type(screen.getByLabelText("Gift name"), "Concert tickets");
    await userEvent.type(screen.getByLabelText("Price"), "12.5.0");
    await userEvent.click(screen.getByRole("button", { name: "Add to list" }));
    expect(screen.getByText("Enter a price like 24.99.")).toBeInTheDocument();
    expect(screen.getByLabelText("Price")).toHaveAttribute("aria-invalid", "true");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("focuses the name as soon as the details open, never later", () => {
    render(<AddGiftPanel onAdd={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add by hand" }));
    // Focus must land in the same update; a delayed focus would pull a fast
    // typist out of the field they'd already moved to.
    expect(screen.getByLabelText("Gift name")).toHaveFocus();
  });
});

describe("adding a gift from another store while signed in (ALL-10)", () => {
  const WALMART = "https://www.walmart.com/ip/Great-Value-Long-Grain-Enriched-Rice-32-oz/10315394";

  async function lookUpWith(readStorePage: ReadPage, url: string) {
    const onAdd = vi.fn();
    render(<AddGiftPanel onAdd={onAdd} readStorePage={readStorePage} />);
    await userEvent.click(screen.getByLabelText("Paste a link"));
    await userEvent.paste(url);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    return onAdd;
  }

  it("fills the name, price and photo read from the store page", async () => {
    const readStorePage = vi.fn<ReadPage>(async () =>
      pageRead({ name: "Great Value Rice, 32 oz", priceCents: 182, imageUrl: "https://i5.walmartimages.com/rice.jpeg" }),
    );
    const onAdd = await lookUpWith(readStorePage, WALMART);
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(readStorePage).toHaveBeenCalledWith(WALMART);
    expect(onAdd).toHaveBeenCalledWith({
      name: "Great Value Rice, 32 oz",
      priceCents: 182,
      imageUrl: "https://i5.walmartimages.com/rice.jpeg",
      productUrl: WALMART,
      asin: null,
      source: "store-page",
    });
  });

  it("asks only for the price when the page has no price (Target)", async () => {
    const readStorePage = vi.fn<ReadPage>(async () =>
      pageRead({ name: "Scarecrow T-Shirt", priceCents: null, imageUrl: "https://target.scene7.com/shirt" }),
    );
    await lookUpWith(readStorePage, "https://www.target.com/p/scarecrow-tee/-/A-1000465184");
    await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
    expect(screen.getByLabelText("Gift name")).toHaveValue("Scarecrow T-Shirt");
    expect(screen.getByLabelText(/Image URL/)).toHaveValue("https://target.scene7.com/shirt");
    expect(screen.getByText(/Got the name and the photo from target\.com/)).toBeInTheDocument();
  });

  it("falls back to the name in the link when the store blocks us", async () => {
    const readStorePage = vi.fn<ReadPage>(async () => ({ ok: false, reason: "http_status" }));
    await lookUpWith(readStorePage, WALMART);
    await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
    expect(screen.getByLabelText("Gift name")).toHaveValue("Great Value Long Grain Enriched Rice 32 Oz");
    expect(screen.getByText(/can’t read prices from/)).toHaveTextContent("walmart.com");
  });

  it("falls back the same way when the server call itself fails", async () => {
    const readStorePage = vi.fn<ReadPage>(async () => {
      throw new Error("offline");
    });
    await lookUpWith(readStorePage, WALMART);
    await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
    expect(screen.getByLabelText("Gift name")).toHaveValue("Great Value Long Grain Enriched Rice 32 Oz");
  });
});

// Amazon answers our server's page reads with a bot check, and its ASIN photo
// shortcut answers newer products with a blank 1x1 picture, so a signed-in
// person's pasted Amazon link is looked up through Zinc for the real photo,
// name and price (ALL-141).
describe("adding an Amazon gift while signed in (ALL-141)", () => {
  const AMAZON = "https://www.amazon.com/dp/B0G5Z36T3N?th=1";
  const CANONICAL = "https://www.amazon.com/dp/B0G5Z36T3N";
  const GUESSED_PHOTO = "https://images-na.ssl-images-amazon.com/images/P/B0G5Z36T3N.01._SCLZZZZZZZ_.jpg";
  const REAL_PHOTO = "https://m.media-amazon.com/images/I/51jwXyqEB3L._AC_SX300_SY300_QL70_ML2_.jpg";

  async function lookUpWith(lookUpAmazon: LookUpAmazon, url: string, readStorePage: ReadPage = vi.fn<ReadPage>()) {
    const onAdd = vi.fn();
    render(<AddGiftPanel onAdd={onAdd} readStorePage={readStorePage} lookUpAmazon={lookUpAmazon} />);
    await userEvent.click(screen.getByLabelText("Paste a link"));
    await userEvent.paste(url);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    return onAdd;
  }

  it("looks the ASIN up and fills the real name, price and photo, without reading the page", async () => {
    const lookUpAmazon = vi.fn<LookUpAmazon>(async () => ({
      ok: true,
      product: { name: "SOULWIT Headband Protector", priceCents: 1195, imageUrl: REAL_PHOTO, productId: "B0G5Z36T3N" },
    }));
    const readStorePage = vi.fn<ReadPage>();
    const onAdd = await lookUpWith(lookUpAmazon, AMAZON, readStorePage);
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(lookUpAmazon).toHaveBeenCalledWith("B0G5Z36T3N");
    expect(readStorePage).not.toHaveBeenCalled();
    expect(onAdd).toHaveBeenCalledWith({
      name: "SOULWIT Headband Protector",
      priceCents: 1195,
      imageUrl: REAL_PHOTO,
      productUrl: CANONICAL,
      asin: "B0G5Z36T3N",
      source: "amazon-zinc",
    });
  });

  it("keeps the guessed photo when Zinc has none, and asks for a missing price", async () => {
    const lookUpAmazon = vi.fn<LookUpAmazon>(async () => ({
      ok: true,
      product: { name: "Wool Hiking Socks, 3 pairs", priceCents: null, imageUrl: null, productId: "B0EXAMPLE1" },
    }));
    await lookUpWith(lookUpAmazon, "https://www.amazon.com/Wool-Hiking-Socks/dp/B0EXAMPLE1");
    await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
    expect(screen.getByLabelText("Gift name")).toHaveValue("Wool Hiking Socks, 3 pairs");
    expect(screen.getByLabelText(/Image URL/)).toHaveValue(
      "https://images-na.ssl-images-amazon.com/images/P/B0EXAMPLE1.01._SCLZZZZZZZ_.jpg",
    );
    expect(screen.getByText(/Got the name from Amazon\. Amazon doesn’t show us the price/)).toBeInTheDocument();
  });

  it("keeps the name from the link when Zinc has no name", async () => {
    const lookUpAmazon = vi.fn<LookUpAmazon>(async () => ({
      ok: true,
      product: { name: null, priceCents: 2400, imageUrl: REAL_PHOTO, productId: "B0EXAMPLE1" },
    }));
    const onAdd = await lookUpWith(lookUpAmazon, "https://www.amazon.com/Wool-Hiking-Socks/dp/B0EXAMPLE1");
    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: "Wool Hiking Socks", priceCents: 2400 })),
    );
  });

  it("says only what Zinc gave when it gave just the name", async () => {
    const lookUpAmazon = vi.fn<LookUpAmazon>(async () => ({
      ok: true,
      product: { name: "Wool Hiking Socks, 3 pairs", priceCents: null, imageUrl: null, productId: "B0EXAMPLE1" },
    }));
    await lookUpWith(lookUpAmazon, "https://www.amazon.com/Wool-Hiking-Socks/dp/B0EXAMPLE1");
    expect(await screen.findByText(/^Got the name from Amazon\./)).toBeInTheDocument();
  });

  it("ignores an answer for a different product", async () => {
    const lookUpAmazon = vi.fn<LookUpAmazon>(async () => ({
      ok: true,
      product: { name: "Something else", priceCents: 999, imageUrl: REAL_PHOTO, productId: "B0OTHER000" },
    }));
    const onAdd = await lookUpWith(lookUpAmazon, "https://www.amazon.com/Wool-Hiking-Socks/dp/B0EXAMPLE1");
    await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
    expect(screen.getByLabelText("Gift name")).toHaveValue("Wool Hiking Socks");
    await userEvent.type(screen.getByLabelText("Price"), "20");
    await userEvent.click(screen.getByRole("button", { name: "Add to list" }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ source: "amazon-url" }));
  });

  it("never lets a slow Amazon lookup overwrite a newer paste", async () => {
    let answerFirst!: (result: AmazonLookupResult) => void;
    const lookUpAmazon = vi.fn<LookUpAmazon>((asin) =>
      asin === "B0EXAMPLE1"
        ? new Promise<AmazonLookupResult>((resolve) => {
            answerFirst = resolve;
          })
        : Promise.resolve({
            ok: true,
            product: { name: "SOULWIT Headband Protector", priceCents: 1195, imageUrl: REAL_PHOTO, productId: "B0G5Z36T3N" },
          }),
    );
    const onAdd = vi.fn();
    render(<AddGiftPanel onAdd={onAdd} readStorePage={vi.fn<ReadPage>()} lookUpAmazon={lookUpAmazon} />);
    const field = screen.getByLabelText("Paste a link");
    await userEvent.click(field);
    await userEvent.paste("https://www.amazon.com/Wool-Hiking-Socks/dp/B0EXAMPLE1");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    // The Add button waits while looking; Enter in the link field starts a new lookup.
    await userEvent.clear(field);
    await userEvent.paste(AMAZON);
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));

    answerFirst({
      ok: true,
      product: { name: "Wool Hiking Socks, 3 pairs", priceCents: 2400, imageUrl: REAL_PHOTO, productId: "B0EXAMPLE1" },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: "SOULWIT Headband Protector" }));
    expect(screen.queryByLabelText("Gift name")).not.toBeInTheDocument();
  });

  it("drops a stand-in fixture price once Zinc answers without one", async () => {
    const lookUpAmazon = vi.fn<LookUpAmazon>(async () => ({
      ok: true,
      product: { name: "Echo Dot (3rd Gen)", priceCents: null, imageUrl: REAL_PHOTO, productId: "B07FZ8S74R" },
    }));
    await lookUpWith(lookUpAmazon, "https://www.amazon.com/dp/B07FZ8S74R");
    await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
    expect(screen.getByLabelText("Price")).toHaveValue("");
  });

  for (const reason of ["off", "not_configured", "over_limit", "not_found", "unavailable"] as const) {
    it(`behaves as before when the lookup is ${reason}`, async () => {
      const lookUpAmazon = vi.fn<LookUpAmazon>(async () => ({ ok: false, reason }));
      const readStorePage = vi.fn<ReadPage>();
      const onAdd = await lookUpWith(lookUpAmazon, "https://www.amazon.com/Wool-Hiking-Socks/dp/B0EXAMPLE1", readStorePage);
      await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
      expect(readStorePage).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Gift name")).toHaveValue("Wool Hiking Socks");
      expect(screen.getByText(/Amazon doesn’t share prices/)).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText("Price"), "20");
      await userEvent.click(screen.getByRole("button", { name: "Add to list" }));
      expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ source: "amazon-url", asin: "B0EXAMPLE1" }));
    });
  }

  it("behaves as before when the server call itself fails", async () => {
    const lookUpAmazon = vi.fn<LookUpAmazon>(async () => {
      throw new Error("offline");
    });
    await lookUpWith(lookUpAmazon, AMAZON);
    await waitFor(() => expect(screen.getByLabelText("Gift name")).toHaveFocus());
    expect(screen.getByLabelText(/Image URL/)).toHaveValue(GUESSED_PHOTO);
  });

  it("doesn't ask the server for guests", async () => {
    await lookUp("https://www.amazon.com/Wool-Hiking-Socks/dp/B0EXAMPLE1");
    await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
    expect(screen.getByLabelText(/Image URL/)).toHaveValue(
      "https://images-na.ssl-images-amazon.com/images/P/B0EXAMPLE1.01._SCLZZZZZZZ_.jpg",
    );
  });
});

describe("pasting a new link starts a fresh draft (ALL-91)", () => {
  const BANANA = "https://bananarepublic.gap.com/browse/product.do?pid=795219002";
  const WALMART = "https://www.walmart.com/ip/Apple-AirTag-2nd-Generation-1-Pack/19390102536";

  async function paste(url: string) {
    const field = screen.getByLabelText("Paste a link");
    await userEvent.clear(field);
    await userEvent.paste(url);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
  }

  it("clears the previous link's price and photo", async () => {
    const readStorePage = vi.fn<ReadPage>(async (url) =>
      url.includes("bananarepublic")
        ? pageRead({ name: "Slim Chino", priceCents: 1997, imageUrl: "https://content.gapinc.com/chino.png" })
        : { ok: false, reason: "nothing_found" },
    );
    const onAdd = vi.fn();
    render(<AddGiftPanel onAdd={onAdd} readStorePage={readStorePage} />);

    await paste(BANANA);
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));

    await paste(WALMART);
    await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
    expect(screen.getByLabelText("Gift name")).toHaveValue("Apple AirTag 2nd Generation 1 Pack");
    expect(screen.getByLabelText("Price")).toHaveValue("");
    expect(screen.getByLabelText(/Image URL/)).toHaveValue("");
  });

  it("clears a price typed before the new link", async () => {
    render(<AddGiftPanel onAdd={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Add by hand" }));
    await userEvent.type(screen.getByLabelText("Price"), "45");
    await userEvent.type(screen.getByLabelText(/Image URL/), "https://example.com/old.jpg");

    await paste(WALMART);
    await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
    expect(screen.getByLabelText("Price")).toHaveValue("");
    expect(screen.getByLabelText(/Image URL/)).toHaveValue("");
  });

  it("still leaves the fields alone when a link can't be read", async () => {
    render(<AddGiftPanel onAdd={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Add by hand" }));
    await userEvent.type(screen.getByLabelText("Gift name"), "Concert tickets");
    await userEvent.type(screen.getByLabelText("Price"), "80");

    await paste("not a link");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Gift name")).toHaveValue("Concert tickets");
    expect(screen.getByLabelText("Price")).toHaveValue("80");
  });
});
