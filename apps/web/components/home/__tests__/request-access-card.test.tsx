import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The check itself is covered by concierge-gate.test.tsx, and the action by actions.test.ts.
const readAccess = vi.hoisted(() => vi.fn());
vi.mock("@/components/concierge-gate", () => ({ readAccess }));
vi.mock("@/app/give/actions", () => ({ requestAccessAction: async () => ({ status: "busy" }) }));

import { RequestAccessCard } from "../request-access-card";

const HEADING = "Want gifts found and shipped for you?";
const show = async () => render(await RequestAccessCard());

beforeEach(() => readAccess.mockReset());

describe("RequestAccessCard", () => {
  it("is nothing with access (AC-9)", async () => {
    readAccess.mockResolvedValue({ access: true, requested: false });
    expect((await show()).container).toBeEmptyDOMElement();
  });

  it("says what the concierge adds, and offers to ask for it (AC-4)", async () => {
    readAccess.mockResolvedValue({ access: false, requested: false });
    await show();
    expect(screen.getByRole("heading", { level: 2, name: HEADING })).toBeInTheDocument();
    expect(
      screen.getByText("Gift ideas, reminders and buying come with the concierge. Request access and we'll email you when you're in."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request access" })).toBeEnabled();
  });

  it("says so once they've asked (AC-4)", async () => {
    readAccess.mockResolvedValue({ access: false, requested: true });
    await show();
    expect(screen.getByText("You asked for access. We'll email you when you're in.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: HEADING })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says to refresh when the check fails, and offers nothing (AC-13)", async () => {
    readAccess.mockResolvedValue(null);
    await show();
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't check your access. Refresh to try again.");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("heading", { name: HEADING })).toBeNull();
  });
});
