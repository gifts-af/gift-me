import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PrivacyPage from "@/app/privacy/page";

const section = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;

describe("the privacy page", () => {
  it("says when it last changed", () => {
    render(<PrivacyPage />);
    expect(screen.getByText("Last updated 25 November 2026")).toBeInTheDocument();
  });

  it("covers Google sign-in and contacts, with Google's Limited Use statement", () => {
    render(<PrivacyPage />);
    const google = section("Google sign-in and contacts");
    expect(google).toHaveTextContent(/off for now/);
    expect(google).toHaveTextContent(/only the ones you tick/);
    expect(google).toHaveTextContent(/never used for ads/);
    expect(google).toHaveTextContent(
      "GiftsAF's use of information received from Google APIs will adhere to Google API Services User Data Policy, including the Limited Use requirements.",
    );
    expect(within(google).getByRole("link", { name: "Google API Services User Data Policy" })).toHaveAttribute(
      "href",
      "https://developers.google.com/terms/api-services-user-data-policy",
    );
  });

  it("covers sign-up and what people store about others", () => {
    render(<PrivacyPage />);
    expect(section("What your account keeps")).toHaveTextContent(/email/);
    expect(section("What you save about other people")).toHaveTextContent(/names.*birthdays.*photos.*addresses/);
  });

  it("says how to ask for erasing, by the page anyone can open (AC-22)", () => {
    render(<PrivacyPage />);
    const asking = section("Asking us to erase data");
    expect(within(asking).getByRole("link", { name: "Feedback" })).toHaveAttribute("href", "/feedback");
    expect(asking).toHaveTextContent(/can't erase/);
  });
});
