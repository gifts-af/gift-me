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
    expect(google).not.toHaveTextContent(/off for now/);
    expect(google).toHaveTextContent(/runs only when you start it/);
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
    expect(section("What your account keeps")).toHaveTextContent(
      "Signing up saves your email and, if you give one, your name.",
    );
    expect(section("What you save about other people")).toHaveTextContent(
      "You can save other people's names, birthdays, photos, addresses and phone numbers, and what they like. It's private to your account: no other user sees it",
    );
  });

  it("says how to ask for erasing, by the page anyone can open (AC-22)", () => {
    render(<PrivacyPage />);
    const asking = section("Asking us to erase data");
    expect(within(asking).getByRole("link", { name: "Feedback" })).toHaveAttribute("href", "/feedback");
    expect(asking).toHaveTextContent(/can't erase/);
  });

  it("promises the three kinds of erasing, and says what stays (AC-22)", () => {
    render(<PrivacyPage />);
    const asking = section("Asking us to erase data");
    const bullets = within(asking).getAllByRole("listitem").map((li) => li.textContent);
    expect(bullets).toEqual([
      expect.stringMatching(/^Your account: we email the account's address to check it's you, then erase/),
      expect.stringMatching(/^A person you added: we email your account's address to check, then erase/),
      expect.stringMatching(/^You, in someone else's account: .*only look for what you tell us/),
    ]);
    expect(asking).toHaveTextContent(/Gift messages other people wrote are kept/);
    expect(asking).toHaveTextContent(/Other people's accounts keep what they typed or copied about you/);
    expect(section("What your account keeps")).toHaveTextContent(/emailed note .* within four days/);
  });

  it("says what reaches us in Gmail", () => {
    render(<PrivacyPage />);
    expect(section("Who else handles it")).toHaveTextContent("Feedback and concierge requests reach us in Gmail.");
  });

  it("says what Zinc and the store get", () => {
    render(<PrivacyPage />);
    expect(section("Who else handles it")).toHaveTextContent(
      /the recipient's name and address, your phone number, and any gift message/,
    );
  });

  it("says who sees the name on a claim", () => {
    render(<PrivacyPage />);
    expect(section("What your account keeps")).toHaveTextContent(/everyone with the list's link.*except its owner/);
    expect(section("What your account keeps")).toHaveTextContent(/by name, never by email/);
    expect(section("What your account keeps")).toHaveTextContent(
      "The name is the one on your account, or the one you typed if you weren't signed in. Signing up with Google starts your account with your Google name. If your account has no name, or you clear it, claims you make after that say \"Someone\". Changing or clearing your name doesn't change claims you already made.",
    );
  });

  it("says what the AI gets when it looks for ideas", () => {
    render(<PrivacyPage />);
    expect(section("What the AI reads")).toHaveTextContent(/ideas.*occasion.*budget/);
  });
});
