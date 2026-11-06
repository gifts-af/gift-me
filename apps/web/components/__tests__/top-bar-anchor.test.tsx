import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TopBar } from "@/components/app-shell/top-bar";
import { HomeTopBar } from "@/components/home/home-top-bar";

// ALL-54: the logo sits in exactly the same spot on every page.
function logoRowClasses(ui: React.ReactElement) {
  const { unmount } = render(ui);
  const row = screen.getByRole("img", { name: "GiftsAF" }).closest("[data-top-bar-row]");
  const classes = row?.getAttribute("class");
  unmount();
  return classes;
}

describe("logo anchoring", () => {
  it("puts the logo in the same row on the home page and in the app", () => {
    const home = logoRowClasses(<HomeTopBar />);
    expect(home).toBeTruthy();
    expect(logoRowClasses(<TopBar />)).toBe(home);
    expect(logoRowClasses(<TopBar><span>tabs</span></TopBar>)).toBe(home);
  });

  it("reserves the scrollbar's space so long and short pages line up", () => {
    const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
    expect(css).toMatch(/html\s*{[^}]*scrollbar-gutter:\s*stable/);
  });
});
