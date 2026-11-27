// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { Learned } from "../Learned";

vi.mock("../../lib/config", () => ({ config: { appOrigin: "https://app.test" } }));

afterEach(cleanup);

const base: ComponentProps<typeof Learned> = {
  personId: "p-j",
  name: "Jimmy",
  extraction: { status: "extracted", facts: [] },
  paidFeatures: true,
  readEstimateCents: 2,
  busy: false,
  error: null,
  onRetry: () => {},
  onAnother: () => {},
};

// Every outcome: the banner first, then its text, then both buttons (AC-14).
function expectFrame(text: string) {
  const banner = screen.getByRole("status");
  expect(banner).toHaveTextContent("Saved to Jimmy");
  const body = screen.getByText(text, { exact: false });
  expect(banner.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const profile = screen.getByRole("link", { name: "See Jimmy's profile" });
  expect(profile).toHaveAttribute("href", "https://app.test/people/p-j/know");
  expect(profile).toHaveAttribute("target", "_blank");
  expect(screen.getByRole("button", { name: "Capture another" })).toBeInTheDocument();
}

describe("Learned: after a save", () => {
  it("reading: the banner says Reading the page…", () => {
    render(<Learned {...base} busy />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved to JimmyReading the page…");
  });

  it("read, with new facts", () => {
    render(
      <Learned
        {...base}
        extraction={{
          status: "extracted",
          facts: [
            { id: "f1", category: "wants", value: "a new reel" },
            { id: "f2", category: "owns", value: "Owala water bottle" },
          ],
        }}
      />,
    );
    expectFrame("Here's what I learned");
    expect(screen.getByRole("heading", { name: "Here's what I learned" })).toBeInTheDocument();
    expect(screen.getByText("Wants: a new reel")).toBeInTheDocument();
    expect(screen.getByText("Already has: Owala water bottle")).toBeInTheDocument();
  });

  it("saved, account without paid features: an amber Not read yet note", () => {
    render(<Learned {...base} paidFeatures={false} extraction={{ status: "pending", facts: [] }} />);
    expectFrame("Not read yet");
    expect(screen.getByRole("note")).toHaveTextContent(
      "Not read yetReading pages with AI costs money, so it's only on for test accounts for now. The page is kept on Jimmy's profile.",
    );
  });

  it("saved, read later", () => {
    render(<Learned {...base} extraction={{ status: "pending", facts: [] }} />);
    expectFrame("We'll read it shortly. What we learn shows on Jimmy's profile.");
  });

  it("saved, couldn't read: Try again and the money note", async () => {
    const onRetry = vi.fn();
    render(<Learned {...base} onRetry={onRetry} extraction={{ status: "failed", facts: [] }} />);
    expectFrame("We couldn't read this page.");
    expect(screen.getByRole("note")).toHaveTextContent("We read each capture with AI, which costs real money: about 2¢ each.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("read, nothing new", () => {
    render(<Learned {...base} />);
    expectFrame("Nothing new to learn from this page. It's kept on Jimmy's profile.");
  });

  it("an older server that didn't say: the banner and both buttons", () => {
    render(<Learned {...base} extraction={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved to Jimmy");
    expect(screen.getByRole("link", { name: "See Jimmy's profile" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Capture another" })).toBeInTheDocument();
  });
});
