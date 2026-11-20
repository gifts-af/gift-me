// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SuccessBanner } from "../SuccessBanner";

afterEach(cleanup);

describe("SuccessBanner", () => {
  it("shows a tick, the title and the detail, announced as a status", () => {
    render(<SuccessBanner title="Saved to Jimmy" detail="Reading the page…" />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("✓Saved to JimmyReading the page…");
    expect(screen.getByText("✓")).toHaveAttribute("aria-hidden", "true");
  });

  it("leaves the detail out when there isn't one", () => {
    render(<SuccessBanner title="Saved to Jimmy" />);
    expect(screen.getByRole("status").textContent).toBe("✓Saved to Jimmy");
  });
});
