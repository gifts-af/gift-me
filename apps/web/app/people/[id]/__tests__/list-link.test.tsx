import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListLink } from "../list-link";

const ok = { ok: true } as const;

function setup(keepsList: boolean, linkResult: { ok: true } | { ok: false; error: string } = ok) {
  const link = vi.fn(async (...a: [unknown, FormData]) => (void a, linkResult));
  const unlink = vi.fn(async (...a: [unknown, FormData]) => (void a, ok));
  render(<ListLink personId="p1" keepsList={keepsList} linkAction={link} unlinkAction={unlink} />);
  return { link, unlink };
}

describe("ListLink", () => {
  it("sends the pasted link with the person", async () => {
    const { link } = setup(false);
    await userEvent.type(screen.getByLabelText("Their list link"), "https://x.test/share/abc");
    await userEvent.click(screen.getByRole("button", { name: "Link" }));
    await waitFor(() => expect(link).toHaveBeenCalled());
    const form = link.mock.calls[0][1];
    expect([form.get("id"), form.get("link")]).toEqual(["p1", "https://x.test/share/abc"]);
  });

  it("says where a waiting gift will go, next to the field (decision 53)", () => {
    setup(false);
    expect(screen.getByText("If a gift for them is waiting on an address, it will ship to this list's owner.")).toBeInTheDocument();
  });

  it("sends a link pasted before the page was ready, which React never saw typed", async () => {
    const { link } = setup(false);
    const input = screen.getByLabelText("Their list link") as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "https://x.test/share/abc");
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(link).toHaveBeenCalled());
    expect(link.mock.calls[0][1].get("link")).toBe("https://x.test/share/abc");
  });

  it.each([
    "That isn't a GiftsAF list link.",
    "That list wasn't found.",
    "That's your own list.",
  ])("shows the error %s", async (error) => {
    setup(false, { ok: false, error });
    await userEvent.type(screen.getByLabelText("Their list link"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(error);
  });

  it("offers Unlink, not the paste field, once linked", async () => {
    const { unlink } = setup(true);
    expect(screen.queryByLabelText("Their list link")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(unlink).toHaveBeenCalled());
    expect(unlink.mock.calls[0][1].get("id")).toBe("p1");
  });
});
