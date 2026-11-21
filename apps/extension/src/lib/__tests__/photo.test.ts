import { describe, expect, it, vi } from "vitest";
import { cropPhoto, orderCandidates, type PhotoBox } from "../photo";

const box = (src: string, width: number, height: number, x = 0, y = 0): PhotoBox => ({ src, x, y, width, height });

describe("orderCandidates", () => {
  it("puts the product image first (same path, ignoring the query), then largest first", () => {
    const big = box("https://shop.test/big.jpg", 600, 600);
    const mid = box("https://cdn.shop.test/img/mug.jpg?w=300", 300, 300);
    const small = box("https://shop.test/small.jpg", 150, 150);
    expect(orderCandidates([small, big, mid], "https://cdn.shop.test/img/mug.jpg?w=1200")).toEqual([mid, big, small]);
  });

  it("orders by area alone with no product image, and doesn't touch the input", () => {
    const wide = box("https://a.test/wide.jpg", 400, 200);
    const tall = box("https://a.test/tall.jpg", 200, 500);
    const input = [wide, tall];
    expect(orderCandidates(input, null)).toEqual([tall, wide]);
    expect(input).toEqual([wide, tall]);
  });

  it("does not match a different path or host", () => {
    const a = box("https://a.test/x.jpg", 100, 100);
    const b = box("https://a.test/y.jpg", 200, 200);
    expect(orderCandidates([a, b], "https://other.test/x.jpg")).toEqual([b, a]);
  });
});

describe("cropPhoto", () => {
  const shot = new Blob(["x"], { type: "image/png" });

  it("crops the box at scale 2.5 and shrinks to widthPx", async () => {
    const out = new Blob(["y"], { type: "image/jpeg" });
    const encode = vi.fn(async () => out);
    const result = await cropPhoto(shot, box("s", 400, 200, 10, 20), 2.5, 400, 80, { encode });
    expect(result).toBe(out);
    expect(encode).toHaveBeenCalledWith(shot, { x: 25, y: 50, width: 1000, height: 500 }, { width: 400, height: 200 }, 80);
  });

  it("doesn't enlarge a crop smaller than widthPx", async () => {
    const encode = vi.fn(async () => new Blob());
    await cropPhoto(shot, box("s", 100, 50, 0, 0), 2, 400, 80, { encode });
    expect(encode).toHaveBeenCalledWith(shot, { x: 0, y: 0, width: 200, height: 100 }, { width: 200, height: 100 }, 80);
  });
});
