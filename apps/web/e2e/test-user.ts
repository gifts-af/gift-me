// Throwaway accounts that exist only in the local Supabase the browser
// tests run against (created by global-setup.ts).
export const TEST_USER = {
  email: "e2e@example.test",
  password: "e2e-local-only-password",
  displayName: "E2E",
};

// A second account, for "this link is for a different account" (ALL-23).
export const SECOND_USER = {
  email: "e2e-second@example.test",
  password: "e2e-local-only-password",
  displayName: "E2E Second",
};
