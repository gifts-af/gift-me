import { describe, expect, it } from "vitest";
import cases from "./match-key-cases.json";
import { cleanLink, matchKey, storeHost } from "./link";

describe("matchKey and storeHost (shared fixture, also run against SQL)", () => {
  it.each(cases)("$url", ({ url, key, host }) => {
    expect(matchKey(url)).toBe(key);
    expect(storeHost(url)).toBe(host);
  });

  it("treats the same product as equal and different variants or ids as different", () => {
    expect(matchKey("https://www.rei.com/product/123/yeti?ref=search")).toBe(
      matchKey("https://rei.com/product/123/yeti/"),
    );
    expect(matchKey("https://shop.com/p?variant=1")).not.toBe(matchKey("https://shop.com/p?variant=2"));
    expect(matchKey("https://shop.com/product.aspx?id=1")).not.toBe(
      matchKey("https://shop.com/product.aspx?id=2"),
    );
    expect(matchKey("https://www.amazon.com/gp/product/B08N5WRWNW")).toBe(
      matchKey("https://www.amazon.com/dp/B08N5WRWNW?th=1"),
    );
  });

  it("falls back to the input for something that is not a link", () => {
    expect(matchKey("not a link")).toBe("not a link");
    expect(storeHost("not a link")).toBe("");
  });
});

describe("cleanLink", () => {
  it("drops tracking tokens and the hash, keeps variant and id", () => {
    expect(
      cleanLink("https://shop.com/p?id=5&mkt_tok=abc&variant=2&UTM_Source=x&spm=1#frag"),
    ).toBe("https://shop.com/p?id=5&variant=2");
  });

  it("leaves a link with nothing to clean alone", () => {
    expect(cleanLink("https://shop.com/p")).toBe("https://shop.com/p");
  });
});
