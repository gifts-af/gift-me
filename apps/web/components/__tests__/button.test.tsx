import { act, render, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, onTestFinished } from "vitest";
import { Button } from "@/components/ui/button";

// ALL-110: a button in the server's HTML shows before React attaches its click
// handler. Until then it looks not ready, so an early tap isn't a silent no-op.
function serverHtml(ui: ReactElement) {
  const container = document.body.appendChild(document.createElement("div"));
  onTestFinished(() => container.remove());
  container.innerHTML = renderToString(ui);
  const hydrate = () =>
    act(async () => {
      render(ui, { container, hydrate: true });
    });
  return { container, hydrate };
}

describe("Button before the page can respond", () => {
  it("marks a plain button not ready, but keeps it reachable by keyboard", async () => {
    const { container, hydrate } = serverHtml(<Button onClick={() => {}}>Go</Button>);
    const button = () => within(container).getByRole("button", { name: "Go" });
    expect(button()).toHaveAttribute("aria-disabled", "true");
    expect(button()).toBeEnabled();
    await hydrate();
    expect(button()).not.toHaveAttribute("aria-disabled");
  });

  it("disables a submit button, so an early tap can't send the form the browser's own way (ALL-60)", async () => {
    const { container, hydrate } = serverHtml(
      <form>
        <Button type="submit">Save</Button>
      </form>,
    );
    const button = () => within(container).getByRole("button", { name: "Save" });
    expect(button()).toBeDisabled();
    await hydrate();
    expect(button()).toBeEnabled();
  });

  it("keeps a submit button disabled after the page is ready when the caller says so", async () => {
    const { container, hydrate } = serverHtml(
      <Button type="submit" disabled>
        Save
      </Button>,
    );
    await hydrate();
    expect(within(container).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("leaves a link styled as a button alone: links work before the page is ready", () => {
    const { container } = serverHtml(
      <Button asChild>
        <a href="/settings">Settings</a>
      </Button>,
    );
    expect(within(container).getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-disabled");
  });

  it("lets the caller's own aria-disabled win", async () => {
    const { container, hydrate } = serverHtml(<Button aria-disabled>Busy</Button>);
    await hydrate();
    expect(within(container).getByRole("button", { name: "Busy" })).toHaveAttribute("aria-disabled", "true");
  });
});
