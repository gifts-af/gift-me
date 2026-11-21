import { describe, expect, it } from "vitest";
import { readAmazonProduct } from "./amazon";
import { readProductFromHtml } from "./read";

// Hand-trimmed to the structure of an Amazon product page: the title in
// #productTitle, the buy-box price in #corePrice_feature_div, and other prices
// (a carousel, a used offer) elsewhere that must never be picked up.
const URL_ = "https://www.amazon.com/Anker-Charger-Compact-Foldable/dp/B0C5T8XQ5R/ref=sr_1_3?crid=ABC";
const PAGE = `<!doctype html><html><head><title>Amazon.com: Anker Charger</title></head><body>
<span id="productTitle">
   Anker 30W USB C Charger, Compact Foldable
</span>
<img id="landingImage" src="https://m.media-amazon.com/images/I/61abc.jpg">
<div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">$17.99</span>
  <span aria-hidden="true"><span class="a-price-whole">17</span></span></span></div>
<div id="similarities_feature_div"><span class="a-price"><span class="a-offscreen">$99.00</span></span></div>
</body></html>`;

describe("readAmazonProduct (ALL-78)", () => {
  it("reads title, buy-box price and ASIN", () => {
    expect(readAmazonProduct(PAGE, URL_)).toEqual({
      isProduct: true,
      name: "Anker 30W USB C Charger, Compact Foldable",
      priceCents: 1799,
      imageUrl: "https://m.media-amazon.com/images/I/61abc.jpg",
      productId: "B0C5T8XQ5R",
      canonicalUrl: null,
    });
  });

  it("reads the price from #apex_desktop when there is no core price block", () => {
    const html = PAGE.replace("corePrice_feature_div", "apex_desktop");
    expect(readAmazonProduct(html, URL_)?.priceCents).toBe(1799);
  });

  it("leaves the price empty rather than taking another block's", () => {
    const html = PAGE.replace("corePrice_feature_div", "other_div");
    expect(readAmazonProduct(html, URL_)?.priceCents).toBeNull();
  });

  it("finds the ASIN in /gp/product/ links", () => {
    expect(readAmazonProduct(PAGE, "https://www.amazon.co.uk/gp/product/B0C5T8XQ5R")?.productId).toBe("B0C5T8XQ5R");
  });

  it("returns null off Amazon, without a title, or without an ASIN", () => {
    expect(readAmazonProduct(PAGE, "https://example.com/dp/B0C5T8XQ5R")).toBeNull();
    expect(readAmazonProduct("<html></html>", URL_)).toBeNull();
    expect(readAmazonProduct(PAGE, "https://www.amazon.com/s?k=chargers")).toBeNull();
  });

  it("is used first by readProductFromHtml on Amazon hosts", () => {
    expect(readProductFromHtml(PAGE, URL_).productId).toBe("B0C5T8XQ5R");
  });
});
