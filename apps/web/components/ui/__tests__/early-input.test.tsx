import { act, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, onTestFinished } from "vitest";
import { render } from "@testing-library/react";
import { Input } from "../input";
import { NativeSelect } from "../native-select";

function server(ui: ReactElement) {
  const container = document.body.appendChild(document.createElement("div"));
  onTestFinished(() => container.remove());
  container.innerHTML = renderToString(ui);
  return {
    field: () => container.querySelector<HTMLInputElement | HTMLSelectElement>("input, select")!,
    hydrate: () => act(async () => void render(ui, { container, hydrate: true })),
  };
}

describe("fields before the page has loaded (ALL-161)", () => {
  it.each([
    ["Input", <Input key="i" value="" onChange={() => {}} />],
    ["NativeSelect", <NativeSelect key="s" value="" onChange={() => {}}><option value="">Choose</option></NativeSelect>],
  ])("%s with its value in state is off until then", async (_, ui) => {
    const { field, hydrate } = server(ui);
    expect(field()).toBeDisabled();
    await hydrate();
    expect(field()).toBeEnabled();
  });

  it.each([
    ["Input", <Input key="i" name="email" />],
    ["Input with a default", <Input key="d" defaultValue="75" />],
    ["NativeSelect", <NativeSelect key="s" name="x"><option value="">Choose</option></NativeSelect>],
  ])("%s that keeps its own value stays on (password managers fill it early)", (_, ui) => {
    expect(server(ui).field()).toBeEnabled();
  });

  it("keeps a caller's own disabled after loading", async () => {
    const { field, hydrate } = server(<Input value="" disabled onChange={() => {}} />);
    await hydrate();
    expect(field()).toBeDisabled();
  });
});
