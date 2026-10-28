// @vitest-environment node
// The colour tokens in app/globals.css must match design/ui.md > Colours, and
// every text-on-fill pair must pass WCAG AA (4.5:1) in both themes.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

const themes = { light: block(":root"), dark: block(".dark") };

// HSL triples from design/ui.md > Colours ("soft" fills from the mock-ups).
const expected = {
  light: {
    background: "0 0% 100%",
    foreground: "240 6% 10%",
    card: "0 0% 100%",
    muted: "240 5% 96%",
    "muted-foreground": "240 4% 46%",
    border: "240 6% 90%",
    input: "240 6% 90%",
    primary: "175 77% 26%",
    "primary-foreground": "0 0% 100%",
    ring: "175 77% 26%",
    accent: "166 76% 97%",
    "accent-foreground": "175 77% 26%",
    secondary: "240 5% 96%",
    destructive: "0 74% 42%",
    success: "142 72% 29%",
    warning: "26 90% 37%",
  },
  dark: {
    background: "240 10% 4%",
    foreground: "0 0% 98%",
    card: "240 6% 10%",
    muted: "240 4% 16%",
    "muted-foreground": "240 5% 65%",
    border: "240 4% 16%",
    input: "240 4% 16%",
    primary: "172 66% 50%",
    "primary-foreground": "179 84% 10%",
    ring: "172 66% 50%",
    accent: "179 84% 10%",
    "accent-foreground": "171 77% 64%",
    secondary: "240 4% 16%",
    destructive: "0 91% 71%",
    success: "142 69% 58%",
    warning: "43 96% 56%",
  },
};

function luminance(triple: string): number {
  const [h, s, l] = triple.replace(/%/g, "").split(/\s+/).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [text, fill]
const pairs = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["muted-foreground", "background"],
  // Grey text on the grey fill is 4.38:1 in light, under AA, so text on
  // --muted always uses --foreground (design/ui.md > Colours).
  ["foreground", "muted"],
  ["primary-foreground", "primary"],
  ["primary", "background"],
  ["accent-foreground", "accent"],
  ["secondary-foreground", "secondary"],
  ["destructive", "background"],
  ["destructive-foreground", "destructive"],
  ["success", "background"],
  ["warning", "background"],
  ["success", "success-soft"],
  ["warning", "warning-soft"],
] as const;

describe.each(Object.keys(themes) as (keyof typeof themes)[])("%s theme", (theme) => {
  it.each(Object.entries(expected[theme]))("--%s matches design/ui.md", (token, value) => {
    expect(themes[theme][token]).toBe(value);
  });

  it.each(pairs)("--%s on --%s passes 4.5:1", (text, fill) => {
    const ratio = contrast(themes[theme][text], themes[theme][fill]);
    expect(ratio, `${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

it("documents why grey text never sits on the grey fill", () => {
  expect(contrast(themes.light["muted-foreground"], themes.light.muted)).toBeLessThan(4.5);
});
