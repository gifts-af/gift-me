// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/supabase/proxy";

describe("isPublicPath", () => {
  it.each(["/", "/lists", "/login", "/share/abc", "/auth/login", "/api/keepalive"])(
    "lets signed-out visitors reach %s",
    (path) => expect(isPublicPath(path)).toBe(true),
  );

  it.each(["/settings", "/api/other", "/lists/123"])(
    "sends signed-out visitors on %s to sign in",
    (path) => expect(isPublicPath(path)).toBe(false),
  );
});
