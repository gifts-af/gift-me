import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Cloudflare's bot-check widget can't load in tests (ALL-68).
vi.mock("@marsidev/react-turnstile", () => import("./turnstile-mock"));
vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
