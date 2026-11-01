import { describe, expect, it } from "vitest";
import { parseEnvFile, validateEnv } from "./validate-env";

const prod = {
  VITE_APP_ORIGIN: "https://giftsaf.com",
  VITE_SUPABASE_URL: "https://prod.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_prod",
  VITE_CAPTURE_JPEG_QUALITY: "70",
  VITE_EXTENSION_KEY: "key",
};
const dev = { ...prod, VITE_APP_ORIGIN: "http://localhost:3000", VITE_SUPABASE_URL: "https://dev.supabase.co" };

describe("parseEnvFile", () => {
  it("reads KEY=value lines and skips comments and blanks", () => {
    expect(parseEnvFile("# c\n\nA=1\nB=x=y\n")).toEqual({ A: "1", B: "x=y" });
  });
});

describe("validateEnv", () => {
  it("accepts the committed values", () => {
    expect(() => validateEnv("production", prod, prod)).not.toThrow();
    expect(() => validateEnv("development", dev, prod)).not.toThrow();
  });

  it("fails when a variable is missing, naming it", () => {
    const rest: Record<string, string> = { ...prod };
    delete rest.VITE_EXTENSION_KEY;
    expect(() => validateEnv("production", rest, prod)).toThrow(/VITE_EXTENSION_KEY/);
  });

  it("rejects an origin with a path, trailing slash or wildcard", () => {
    for (const bad of ["https://giftsaf.com/", "https://giftsaf.com/x", "https://*.giftsaf.com"]) {
      expect(() => validateEnv("development", { ...dev, VITE_APP_ORIGIN: bad }, prod)).toThrow(/VITE_APP_ORIGIN/);
    }
  });

  it("requires VITE_CAPTURE_JPEG_QUALITY to be a whole number from 1 to 100", () => {
    for (const bad of ["0", "101", "70.5", "abc", "-5", "1e2"]) {
      expect(() => validateEnv("development", { ...dev, VITE_CAPTURE_JPEG_QUALITY: bad }, prod)).toThrow(
        /VITE_CAPTURE_JPEG_QUALITY/,
      );
    }
    for (const ok of ["1", "100"]) {
      expect(() => validateEnv("development", { ...dev, VITE_CAPTURE_JPEG_QUALITY: ok }, prod)).not.toThrow();
    }
  });

  it("production refuses dev values, such as from a .env.local or shell override", () => {
    expect(() => validateEnv("production", dev, prod)).toThrow(/VITE_APP_ORIGIN/);
    expect(() => validateEnv("production", { ...prod, VITE_SUPABASE_URL: dev.VITE_SUPABASE_URL }, prod)).toThrow(
      /VITE_SUPABASE_URL/,
    );
  });
});
