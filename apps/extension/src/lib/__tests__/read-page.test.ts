// @vitest-environment jsdom
import { readProductFromHtml } from "@gifts-af/core/store-page";
import { beforeEach, describe, expect, it } from "vitest";
import { installFakeChrome, type FakeChrome } from "../../test/fake-chrome";
import { readProductPage } from "../page";

let fake: FakeChrome;
const jsdom = (globalThis as unknown as { jsdom: { reconfigure(o: { url: string }): void } }).jsdom;

beforeEach(() => {
  fake = installFakeChrome();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
});

function load(html: string, url: string) {
  jsdom.reconfigure({ url });
  document.documentElement.innerHTML = html;
}

function place(img: HTMLElement, left: number, top: number, width: number, height: number) {
  Object.defineProperty(img, "getBoundingClientRect", {
    value: () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }),
  });
}

const FILLER = `<nav>Menu</nav><p>${"Lots of body text that never needs to leave the page. ".repeat(50)}</p>`;

const JSON_LD = `<html><head><title>Mug</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Stoneware mug","sku":"MUG-1",
"image":"/img/mug.jpg","offers":{"@type":"Offer","price":"24.50","priceCurrency":"USD"}}</script>
<link rel="canonical" href="https://shop.test/mug"></head><body>${FILLER}</body></html>`;

const MICRODATA = `<html><head><title>Plate</title><meta property="og:title" content="Ignored OG title"></head><body>
<div itemscope itemtype="https://schema.org/Product">
  <h1 itemprop="name">Linen plate</h1>
  <img itemprop="image" src="/img/plate.jpg">
  <span itemprop="priceCurrency" content="USD"></span><span itemprop="price" content="12.00">$12</span>
  <meta itemprop="sku" content="PLATE-9">
</div>${FILLER}</body></html>`;

const OG_ONLY = `<html><head><meta property="og:title" content="A holiday photo"><meta property="og:image" content="https://shop.test/p.jpg">
<meta property="og:type" content="article"></head><body>${FILLER}</body></html>`;

const AMAZON = `<html><head><title>Amazon.com: Bottle</title></head><body>
<span id="productTitle">  Owala water bottle  </span>
<div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">$27.99</span><span aria-hidden="true">$27.99</span></span></div>
<div id="sims"><span class="a-price"><span class="a-offscreen">$1.00</span></span></div>
<img id="landingImage" src="https://m.media-amazon.com/images/I/bottle.jpg">${FILLER}</body></html>`;

const WALMART = `<html><head><meta property="og:title" content="Blender - Walmart.com"></head><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: { pageProps: { initialData: { data: { product: { priceInfo: { currentPrice: { price: 39.97, currencyUnit: "USD" } } } } } } },
})}</script>${FILLER}</body></html>`;

const cases: [string, string, string][] = [
  ["JSON-LD", JSON_LD, "https://shop.test/mug?utm=1"],
  ["microdata", MICRODATA, "https://shop.test/plate"],
  ["Open Graph only (not a product)", OG_ONLY, "https://shop.test/blog/post"],
  ["Amazon", AMAZON, "https://www.amazon.com/Owala/dp/B0BZYCJK89/ref=x"],
  ["Walmart page data", WALMART, "https://www.walmart.com/ip/blender/123"],
];

describe("readProductPage: slim fragments read the same as the full page", () => {
  it.each(cases)("%s", async (_name, html, url) => {
    const expected = readProductFromHtml(html, url);
    load(html, url);
    const page = await readProductPage(7);
    expect(page.product).toEqual(expected);
    expect(page.pageUrl).toBe(url);
  });

  it("the fixtures really read something", () => {
    expect(readProductFromHtml(JSON_LD, "https://shop.test/mug").priceCents).toBe(2450);
    expect(readProductFromHtml(MICRODATA, "https://shop.test/plate")).toMatchObject({ isProduct: true, name: "Linen plate", priceCents: 1200 });
    expect(readProductFromHtml(OG_ONLY, "https://shop.test/b").isProduct).toBe(false);
    expect(readProductFromHtml(AMAZON, "https://www.amazon.com/dp/B0BZYCJK89").priceCents).toBe(2799);
    expect(readProductFromHtml(WALMART, "https://www.walmart.com/ip/b/1").priceCents).toBe(3997);
  });
});

describe("readProductPage: what is read and sent along", () => {
  it("takes one screenshot and returns the viewport width", async () => {
    load(JSON_LD, "https://shop.test/mug");
    const page = await readProductPage(7);
    expect(fake.tabs.captures).toHaveLength(1);
    expect(page.screenshot.type).toBe("image/jpeg");
    expect(page.viewportWidth).toBe(1000);
  });

  it("does not read the page text into the fragments", async () => {
    load(JSON_LD, "https://shop.test/mug");
    await readProductPage(7);
    const fn = fake.scripting.calls[0].func as () => unknown;
    expect(JSON.stringify(fn())).not.toContain("Lots of body text");
  });

  it("lists images 120px or more each way and mostly visible; skips data: images", async () => {
    load(
      `<body><img id="ok" src="https://shop.test/a.jpg"><img id="tiny" src="https://shop.test/t.gif"><img id="data" src="data:image/png;base64,AAAA">
       <img id="narrow" src="https://shop.test/n.jpg"><img id="off" src="https://shop.test/o.jpg"><img id="edge" src="https://shop.test/e.jpg"></body>`,
      "https://shop.test/x",
    );
    const el = (id: string) => document.getElementById(id)!;
    place(el("ok"), 100, 50, 300, 300);
    place(el("tiny"), 0, 0, 1, 1);
    place(el("data"), 0, 0, 300, 300);
    place(el("narrow"), 0, 0, 119, 300);
    place(el("off"), -150, 0, 200, 200); // 50 of 200 wide visible
    place(el("edge"), -100, 0, 200, 200); // exactly half visible, not more
    const page = await readProductPage(7);
    expect(page.candidates).toEqual([{ src: "https://shop.test/a.jpg", x: 100, y: 50, width: 300, height: 300 }]);
  });

  it("clips a mostly visible image to the viewport", async () => {
    load(`<body><img id="a" src="https://shop.test/a.jpg"></body>`, "https://shop.test/x");
    place(document.getElementById("a")!, -40, 650, 300, 200); // visible 260 x 150 of 300 x 200 = 65%
    const page = await readProductPage(7);
    expect(page.candidates).toEqual([{ src: "https://shop.test/a.jpg", x: 0, y: 650, width: 260, height: 150 }]);
  });
});
