// @vitest-environment node
import { describe, expect, it } from "vitest";
import { authErrorMessage } from "@/lib/auth-errors";

describe("authErrorMessage", () => {
  it.each(["cancelled", "failed", "incomplete"])("has its own words for %s", (code) => {
    expect(authErrorMessage(code)).not.toBe(authErrorMessage(undefined));
  });

  it.each(["Your account is locked, call 555", "", undefined])("falls back to a fixed message for %j", (value) => {
    expect(authErrorMessage(value)).toBe("Something went wrong while signing you in.");
  });
});
