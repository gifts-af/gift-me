import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RememberHomeTab } from "../remember-home-tab";

afterEach(() => {
  document.cookie = "home_tab=; Path=/; Max-Age=0";
});

describe("RememberHomeTab", () => {
  it("remembers the tab of the page that's open", () => {
    render(<RememberHomeTab tab="give" />);
    expect(document.cookie).toContain("home_tab=give");
  });

  it("switches when the other tab opens", () => {
    const { rerender } = render(<RememberHomeTab tab="give" />);
    rerender(<RememberHomeTab tab="get" />);
    expect(document.cookie).toContain("home_tab=get");
  });
});
