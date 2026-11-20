import { describe, expect, it } from "vitest";
import { readProductFromHtml } from "./read";

// Trimmed copies of the shapes real store pages served on 2026-11-03 (ALL-10).
// Only the tags the reader looks at are kept.

const WALMART_URL = "https://www.walmart.com/ip/Great-Value-Long-Grain-Enriched-Rice-32-oz/10315394";
const WALMART = `<!doctype html><html><head>
<meta property="og:title" content="Great Value Long Grain Enriched Rice, 32 oz (2 lb) - Walmart.com"/>
<meta property="og:type" content="product.item"/>
<meta property="og:image" content="https://i5.walmartimages.com/seo/Great-Value-Rice_d67beb52.jpeg"/>
<meta property="og:site_name" content="Walmart.com"/>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
</head><body>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"initialData":{"data":{
  "product":{"name":"Great Value Long Grain Enriched Rice, 32 oz (2 lb)",
    "priceInfo":{"currentPrice":{"price":1.82,"priceString":"$1.82","currencyUnit":"USD"}}},
  "contentLayout":{"modules":[{"currentPrice":{"price":25.98,"currencyUnit":"USD"}}]}
}}}}}</script>
</body></html>`;

const BANANA_URL = "https://bananarepublic.gap.com/browse/product.do?pid=795219002";
const BANANA = `<html><head><title>Slim Rapid Movement Chino | Banana Republic</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product",
  "name":"Slim Rapid Movement Chino",
  "image":["https://content.gapinc.com/b/0028/063/070/cn28063070.png?width=520","https://content.gapinc.com/b/2.jpg"],
  "offers":[{"@type":"Offer","price":"19.97","priceCurrency":"USD"},{"@type":"Offer","price":"19.97","priceCurrency":"USD"}]}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
</head><body></body></html>`;

const TARGET_URL = "https://www.target.com/p/men-s-wizard-of-oz-scarecrow-long-sleeve-graphic-t-shirt/-/A-1000465184";
const TARGET = `<html><head>
<meta content="Men&#x27;s - Wizard of Oz - Scarecrow Long Sleeve Graphic T-Shirt" property="og:title" data-next-head=""/>
<meta content="https://target.scene7.com/is/image/Target/GUEST_87fa1d15" property="og:image" data-next-head=""/>
</head><body><div>Loading price…</div></body></html>`;

const NOTHING = { isProduct: false, name: null, priceCents: null, imageUrl: null, productId: null, canonicalUrl: null };

describe("readProductFromHtml (ALL-10)", () => {
  it("reads Walmart's name and photo from its share tags and the price from its page data", () => {
    expect(readProductFromHtml(WALMART, WALMART_URL)).toEqual({
      name: "Great Value Long Grain Enriched Rice, 32 oz (2 lb)",
      priceCents: 182,
      imageUrl: "https://i5.walmartimages.com/seo/Great-Value-Rice_d67beb52.jpeg",
      isProduct: true,
      productId: null,
      canonicalUrl: null,
    });
  });

  it("never takes Walmart's price from another product on the same page", () => {
    const noMainPrice = WALMART.replace('"price":1.82', '"price":null');
    expect(readProductFromHtml(noMainPrice, WALMART_URL).priceCents).toBeNull();
  });

  it("reads a brand site's standard product block (Banana Republic)", () => {
    expect(readProductFromHtml(BANANA, BANANA_URL)).toEqual({
      name: "Slim Rapid Movement Chino",
      priceCents: 1997,
      imageUrl: "https://content.gapinc.com/b/0028/063/070/cn28063070.png?width=520",
      isProduct: true,
      productId: null,
      canonicalUrl: null,
    });
  });

  it("reads Target's name and photo, and leaves the price for the person", () => {
    expect(readProductFromHtml(TARGET, TARGET_URL)).toEqual({
      name: "Men's - Wizard of Oz - Scarecrow Long Sleeve Graphic T-Shirt",
      priceCents: null,
      imageUrl: "https://target.scene7.com/is/image/Target/GUEST_87fa1d15",
      isProduct: false,
      productId: null,
      canonicalUrl: null,
    });
  });

  it("finds the product inside an @graph, and gives no price for a price range (T77)", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},
      {"@type":["Product"],"name":"Blue Mug","image":{"@type":"ImageObject","url":"/img/mug.jpg"},
       "offers":{"@type":"AggregateOffer","lowPrice":12,"highPrice":20,"priceCurrency":"USD"}}]}</script>`;
    expect(readProductFromHtml(html, "https://shop.example.com/products/blue-mug")).toEqual({
      name: "Blue Mug",
      priceCents: null,
      imageUrl: "https://shop.example.com/img/mug.jpg",
      isProduct: true,
      productId: null,
      canonicalUrl: null,
    });
  });

  it("falls back to microdata", () => {
    const html = `<div itemscope itemtype="https://schema.org/Product">
      <h1 itemprop="name">Wool Socks</h1>
      <img itemprop="image" src="https://cdn.example.com/socks.jpg">
      <span itemprop="price" content="1,024.50">$1,024.50</span>
      <meta itemprop="priceCurrency" content="USD"></div>`;
    expect(readProductFromHtml(html, "https://example.com/socks")).toEqual({
      name: "Wool Socks",
      priceCents: 102450,
      imageUrl: "https://cdn.example.com/socks.jpg",
      isProduct: true,
      productId: null,
      canonicalUrl: null,
    });
  });

  it("falls back to Open Graph price tags", () => {
    const html = `<meta property="og:title" content="Candle | Shop Co"><meta property="og:site_name" content="Shop Co">
      <meta property="product:price:amount" content="24.00"><meta property="product:price:currency" content="USD">`;
    expect(readProductFromHtml(html, "https://shopco.com/candle")).toEqual({
      name: "Candle",
      priceCents: 2400,
      imageUrl: null,
      isProduct: true,
      productId: null,
      canonicalUrl: null,
    });
  });

  it("ignores prices in other currencies (US only for now)", () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"Teapot",
      "offers":{"price":"30.00","priceCurrency":"GBP"}}</script>`;
    expect(readProductFromHtml(html, "https://example.co.uk/teapot").priceCents).toBeNull();
  });

  it("ignores photos that aren't web links", () => {
    const html = `<meta property="og:title" content="Thing"><meta property="og:image" content="javascript:alert(1)">`;
    expect(readProductFromHtml(html, "https://example.com/thing").imageUrl).toBeNull();
  });

  it("returns nothing from a captcha page or broken product data, without guessing", () => {
    const captcha = `<html><head><title>Robot or human?</title></head><body>Activate and hold the button</body></html>`;
    expect(readProductFromHtml(captcha, WALMART_URL)).toEqual({ ...NOTHING });
    const broken = `<script type="application/ld+json">{"@type":"Product",</script>`;
    expect(readProductFromHtml(broken, "https://example.com/x")).toEqual({ ...NOTHING });
  });

  it("gives a flat low price when low and high agree", () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"Pen",
      "offers":{"@type":"AggregateOffer","lowPrice":"3.00","highPrice":"3.00","priceCurrency":"USD"}}</script>`;
    expect(readProductFromHtml(html, "https://example.com/pen").priceCents).toBe(300);
  });
});

describe("readProductFromHtml product signals and ids (ALL-78)", () => {
  const jsonLd = (obj: object) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
  const PAGE = "https://shop.example.com/p/mug";

  it("reads productId from JSON-LD sku", () => {
    const html = jsonLd({ "@type": "Product", name: "Mug", sku: "MUG-1", gtin13: "123" });
    expect(readProductFromHtml(html, PAGE)).toMatchObject({ isProduct: true, productId: "MUG-1" });
  });

  it("falls through gtin, mpn and productID in order", () => {
    expect(readProductFromHtml(jsonLd({ "@type": "Product", gtin12: "0123" }), PAGE).productId).toBe("0123");
    expect(readProductFromHtml(jsonLd({ "@type": "Product", mpn: "M9" }), PAGE).productId).toBe("M9");
    expect(readProductFromHtml(jsonLd({ "@type": "Product", productID: "P7" }), PAGE).productId).toBe("P7");
    expect(readProductFromHtml(jsonLd({ "@type": "Product", sku: 42 }), PAGE).productId).toBe("42");
  });

  it("reads productId from microdata when JSON-LD has none", () => {
    const html = `<div itemscope itemtype="https://schema.org/Product"><h1 itemprop="name">Mug</h1>
      <meta itemprop="sku" content="MD-5"></div>`;
    expect(readProductFromHtml(html, PAGE)).toMatchObject({ isProduct: true, productId: "MD-5" });
  });

  it("keeps a canonical link on the same host, ignoring www.", () => {
    const html = `<link rel="canonical" href="https://shop.example.com/p/mug-canonical">` + jsonLd({ "@type": "Product" });
    expect(readProductFromHtml(html, "https://www.shop.example.com/p/mug?utm=1").canonicalUrl).toBe(
      "https://shop.example.com/p/mug-canonical",
    );
  });

  it("drops a canonical link on another host", () => {
    const html = `<link rel="canonical" href="https://evil.example.org/p/mug">` + jsonLd({ "@type": "Product" });
    expect(readProductFromHtml(html, PAGE).canonicalUrl).toBeNull();
  });

  it("falls back to og:url, then JSON-LD url, for the canonical link", () => {
    const og = `<meta property="og:url" content="https://shop.example.com/og">`;
    expect(readProductFromHtml(og, PAGE).canonicalUrl).toBe("https://shop.example.com/og");
    const ld = jsonLd({ "@type": "Product", url: "/ld-url" });
    expect(readProductFromHtml(ld, PAGE).canonicalUrl).toBe("https://shop.example.com/ld-url");
  });

  it("takes offers.price, not the list price, for a sale item", () => {
    const html = jsonLd({
      "@type": "Product",
      name: "Mug",
      offers: { "@type": "Offer", price: "15.00", priceCurrency: "USD", priceSpecification: [{ price: "20.00", priceCurrency: "USD" }] },
    });
    expect(readProductFromHtml(html, PAGE).priceCents).toBe(1500);
  });

  it("is not a product with only og:title and og:image", () => {
    const html = `<meta property="og:title" content="Holiday photo"><meta property="og:image" content="https://x.com/a.jpg">`;
    expect(readProductFromHtml(html, "https://www.instagram.com/p/abc")).toMatchObject({ isProduct: false, name: "Holiday photo" });
  });

  it("counts og:type product, product.item, a product:price tag and microdata as product signals", () => {
    expect(readProductFromHtml(`<meta property="og:type" content="product">`, PAGE).isProduct).toBe(true);
    expect(readProductFromHtml(`<meta property="og:type" content="product.item">`, PAGE).isProduct).toBe(true);
    expect(readProductFromHtml(`<meta property="og:type" content="article">`, PAGE).isProduct).toBe(false);
    expect(readProductFromHtml(`<meta property="product:price:amount" content="5">`, PAGE).isProduct).toBe(true);
    expect(readProductFromHtml(`<div itemtype="http://schema.org/Product"></div>`, PAGE).isProduct).toBe(true);
  });

  it("counts a ProductGroup as a product", () => {
    expect(readProductFromHtml(jsonLd({ "@type": "ProductGroup", name: "Shirt" }), PAGE).isProduct).toBe(true);
  });
});
