import { act, render, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const { PersonForm } = await import("@/app/people/person-form");
const { FeedbackButton } = await import("@/components/home/feedback-dialog");
const { RequestAccessButton } = await import("@/components/home/request-access-dialog");
const { Tour } = await import("@/components/tour/tour");
const { Switch } = await import("@/components/ui/switch");

// ALL-110: buttons in the server's HTML that aren't our Button component. A tap
// before the page's JavaScript has loaded does nothing, so each looks not
// ready until then, and is ready once the page has hydrated.
const cases: [string, ReactElement, string][] = [
  ["the tour's Next", <Tour key="tour" />, "Next"],
  ["the home page's Request access", <RequestAccessButton key="ra" />, "Request access"],
  ["the home page's Send feedback", <FeedbackButton key="fb" />, "Send feedback"],
  // Occasions on a person's page, and sharing my address on /lists.
  ["a switch", <Switch key="sw" aria-label="Remind me" />, "Remind me"],
  ["the person form's photo button", <PersonForm key="pf" action={vi.fn()} photoAction={vi.fn()} userId="u1" maxUploadBytes={1000} px={512} doneHref="/" />, "Add a photo"],
];

describe("buttons before the page can respond", () => {
  it.each(cases)("%s is marked not ready, then ready once the page has loaded", async (_, ui, name) => {
    const container = document.body.appendChild(document.createElement("div"));
    onTestFinished(() => container.remove());
    container.innerHTML = renderToString(ui);
    const button = () => within(container).getByRole(name === "Remind me" ? "switch" : "button", { name });
    expect(button()).toHaveAttribute("aria-disabled", "true");
    expect(button()).toBeEnabled();

    await act(async () => {
      render(ui, { container, hydrate: true });
    });
    expect(button()).not.toHaveAttribute("aria-disabled");
  });
});
