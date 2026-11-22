import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddGiftPanel from "../add-gift-panel";

async function lookUp(url) {
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
  it("shows a full match as a card to confirm, then adds it", async () => {
    const onAdd = await lookUp("https://www.amazon.com/dp/B07FZ8S74R");
    await screen.findByText(/Echo Dot \(3rd Gen\)/);
    expect(screen.getByText(/\$39\.99 · found on Amazon/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add to list" }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ priceCents: 3999, asin: "B07FZ8S74R", source: "amazon-fixture" }),
    );
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
    const onAdd = await lookUp(
      "https://www.walmart.com/ip/Great-Value-Long-Grain-Enriched-Rice-32-oz/10315394",
    );
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

  async function lookUpWith(readStorePage, url) {
    const onAdd = vi.fn();
    render(<AddGiftPanel onAdd={onAdd} readStorePage={readStorePage} />);
    await userEvent.click(screen.getByLabelText("Paste a link"));
    await userEvent.paste(url);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    return onAdd;
  }

  it("fills the name, price and photo read from the store page", async () => {
    const readStorePage = vi.fn(async () => ({
      ok: true,
      product: { name: "Great Value Rice, 32 oz", priceCents: 182, imageUrl: "https://i5.walmartimages.com/rice.jpeg" },
    }));
    const onAdd = await lookUpWith(readStorePage, WALMART);
    expect(await screen.findByText(/\$1\.82 · found on walmart\.com/)).toBeInTheDocument();
    expect(readStorePage).toHaveBeenCalledWith(WALMART);
    await userEvent.click(screen.getByRole("button", { name: "Add to list" }));
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
    const readStorePage = vi.fn(async () => ({
      ok: true,
      product: { name: "Scarecrow T-Shirt", priceCents: null, imageUrl: "https://target.scene7.com/shirt" },
    }));
    await lookUpWith(readStorePage, "https://www.target.com/p/scarecrow-tee/-/A-1000465184");
    await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
    expect(screen.getByLabelText("Gift name")).toHaveValue("Scarecrow T-Shirt");
    expect(screen.getByLabelText(/Image URL/)).toHaveValue("https://target.scene7.com/shirt");
    expect(screen.getByText(/Got the name and the photo from target\.com/)).toBeInTheDocument();
  });

  it("falls back to the name in the link when the store blocks us", async () => {
    const readStorePage = vi.fn(async () => ({ ok: false, reason: "http_status" }));
    await lookUpWith(readStorePage, WALMART);
    await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
    expect(screen.getByLabelText("Gift name")).toHaveValue("Great Value Long Grain Enriched Rice 32 Oz");
    expect(screen.getByText(/can’t read prices from/)).toHaveTextContent("walmart.com");
  });

  it("falls back the same way when the server call itself fails", async () => {
    const readStorePage = vi.fn(async () => {
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

  async function lookUpWith(lookUpAmazon, url, readStorePage = vi.fn()) {
    const onAdd = vi.fn();
    render(<AddGiftPanel onAdd={onAdd} readStorePage={readStorePage} lookUpAmazon={lookUpAmazon} />);
    await userEvent.click(screen.getByLabelText("Paste a link"));
    await userEvent.paste(url);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    return onAdd;
  }

  it("looks the ASIN up and fills the real name, price and photo, without reading the page", async () => {
    const lookUpAmazon = vi.fn(async () => ({
      ok: true,
      product: { name: "SOULWIT Headband Protector", priceCents: 1195, imageUrl: REAL_PHOTO, productId: "B0G5Z36T3N" },
    }));
    const readStorePage = vi.fn();
    const onAdd = await lookUpWith(lookUpAmazon, AMAZON, readStorePage);
    expect(await screen.findByText(/\$11\.95 · found on Amazon/)).toBeInTheDocument();
    expect(lookUpAmazon).toHaveBeenCalledWith("B0G5Z36T3N");
    expect(readStorePage).not.toHaveBeenCalled();
    expect(screen.getByText("Found it. Check the details, then add it.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add to list" }));
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
    const lookUpAmazon = vi.fn(async () => ({
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
    const lookUpAmazon = vi.fn(async () => ({
      ok: true,
      product: { name: null, priceCents: 2400, imageUrl: REAL_PHOTO, productId: "B0EXAMPLE1" },
    }));
    await lookUpWith(lookUpAmazon, "https://www.amazon.com/Wool-Hiking-Socks/dp/B0EXAMPLE1");
    expect(await screen.findByText(/\$24\.00 · found on Amazon/)).toBeInTheDocument();
    expect(screen.getByText("Wool Hiking Socks")).toBeInTheDocument();
  });

  it("says only what Zinc gave when it gave just the name", async () => {
    const lookUpAmazon = vi.fn(async () => ({
      ok: true,
      product: { name: "Wool Hiking Socks, 3 pairs", priceCents: null, imageUrl: null, productId: "B0EXAMPLE1" },
    }));
    await lookUpWith(lookUpAmazon, "https://www.amazon.com/Wool-Hiking-Socks/dp/B0EXAMPLE1");
    expect(await screen.findByText(/^Got the name from Amazon\./)).toBeInTheDocument();
  });

  it("ignores an answer for a different product", async () => {
    const lookUpAmazon = vi.fn(async () => ({
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
    let answerFirst;
    const lookUpAmazon = vi.fn((asin) =>
      asin === "B0EXAMPLE1"
        ? new Promise((resolve) => {
            answerFirst = resolve;
          })
        : Promise.resolve({
            ok: true,
            product: { name: "SOULWIT Headband Protector", priceCents: 1195, imageUrl: REAL_PHOTO, productId: "B0G5Z36T3N" },
          }),
    );
    render(<AddGiftPanel onAdd={vi.fn()} readStorePage={vi.fn()} lookUpAmazon={lookUpAmazon} />);
    const field = screen.getByLabelText("Paste a link");
    await userEvent.click(field);
    await userEvent.paste("https://www.amazon.com/Wool-Hiking-Socks/dp/B0EXAMPLE1");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    // The Add button waits while looking; Enter in the link field starts a new lookup.
    await userEvent.clear(field);
    await userEvent.paste(AMAZON);
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByText(/\$11\.95 · found on Amazon/)).toBeInTheDocument();

    answerFirst({
      ok: true,
      product: { name: "Wool Hiking Socks, 3 pairs", priceCents: 2400, imageUrl: REAL_PHOTO, productId: "B0EXAMPLE1" },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText(/\$11\.95 · found on Amazon/)).toBeInTheDocument();
    expect(screen.queryByText(/Wool Hiking Socks/)).not.toBeInTheDocument();
    expect(screen.getByText("SOULWIT Headband Protector")).toBeInTheDocument();
  });

  it("drops a stand-in fixture price once Zinc answers without one", async () => {
    const lookUpAmazon = vi.fn(async () => ({
      ok: true,
      product: { name: "Echo Dot (3rd Gen)", priceCents: null, imageUrl: REAL_PHOTO, productId: "B07FZ8S74R" },
    }));
    await lookUpWith(lookUpAmazon, "https://www.amazon.com/dp/B07FZ8S74R");
    await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
    expect(screen.getByLabelText("Price")).toHaveValue("");
  });

  for (const reason of ["off", "not_configured", "over_limit", "not_found", "unavailable"]) {
    it(`behaves as before when the lookup is ${reason}`, async () => {
      const lookUpAmazon = vi.fn(async () => ({ ok: false, reason }));
      const readStorePage = vi.fn();
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
    const lookUpAmazon = vi.fn(async () => {
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

  async function paste(url) {
    const field = screen.getByLabelText("Paste a link");
    await userEvent.clear(field);
    await userEvent.paste(url);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
  }

  it("clears the previous link's price and photo", async () => {
    const readStorePage = vi.fn(async (url) =>
      url.includes("bananarepublic")
        ? { ok: true, product: { name: "Slim Chino", priceCents: 1997, imageUrl: "https://content.gapinc.com/chino.png" } }
        : { ok: false, reason: "nothing_found" },
    );
    render(<AddGiftPanel onAdd={vi.fn()} readStorePage={readStorePage} />);

    await paste(BANANA);
    await screen.findByText(/\$19\.97 · found on bananarepublic\.gap\.com/);

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
