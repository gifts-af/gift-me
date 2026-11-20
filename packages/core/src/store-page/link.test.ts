import { describe, expect, it } from "vitest";
import { cleanLink, productLink } from "./link";

describe("cleanLink", () => {
  it("drops tracking tokens and the hash, keeps variant and id", () => {
    expect(
      cleanLink("https://shop.com/p?id=5&mkt_tok=abc&variant=2&UTM_Source=x&spm=1#frag"),
    ).toBe("https://shop.com/p?id=5&variant=2");
  });

  it("drops a user name and password from the link (S2)", () => {
    expect(cleanLink("https://sam:secret@shop.com/p?id=5")).toBe("https://shop.com/p?id=5");
  });

  it("leaves a link with nothing to clean alone", () => {
    expect(cleanLink("https://shop.com/p")).toBe("https://shop.com/p");
  });
});

describe("productLink", () => {
  const page = "https://www.shop.test/products/tee?variant=222&utm_source=x";

  it("carries the page's variant onto a Shopify-style canonical with the same host and path", () => {
    expect(productLink(page, "https://shop.test/products/tee")).toBe("https://shop.test/products/tee?variant=222");
  });

  it("carries every kept parameter, any case, and nothing else", () => {
    expect(
      productLink("https://m.shop.test/p/1/?Size=M&COLOR=red&foo=1&SkuId=9", "https://shop.test/p/1"),
    ).toBe("https://shop.test/p/1?Size=M&COLOR=red&SkuId=9");
  });

  it("lets the page's value replace the canonical's for the same key", () => {
    expect(productLink("https://shop.test/p?variant=2", "https://shop.test/p?VARIANT=1&x=y")).toBe(
      "https://shop.test/p?x=y&variant=2",
    );
  });

  it("uses the canonical as is when its path differs", () => {
    expect(productLink("https://shop.test/collections/x/products/tee?variant=2", "https://shop.test/products/tee")).toBe(
      "https://shop.test/products/tee",
    );
  });

  it("uses the canonical as is when its host differs", () => {
    expect(productLink("https://shop.test/p?variant=2", "https://other.test/p")).toBe("https://other.test/p");
  });

  it("uses the page link, cleaned, when there's no canonical", () => {
    expect(productLink(page, null)).toBe("https://www.shop.test/products/tee?variant=222");
  });

  it("cleans tracking from the canonical too", () => {
    expect(productLink("https://shop.test/p", "https://shop.test/p?gclid=1")).toBe("https://shop.test/p");
  });
});
