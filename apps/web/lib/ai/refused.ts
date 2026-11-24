import { z } from "zod";

// What a failed AI SDK call throws, as far as telling a refusal needs. A Gateway error and a
// direct provider's both carry the HTTP status. With retries off, the SDK throws them as they are.
const failedCall = z.object({ name: z.string(), statusCode: z.number().optional() });

// The SDK replaces a Gateway 401 with a plain error: no status, only one of these names
// (production, then elsewhere).
const UNAUTHENTICATED = ["GatewayError", "GatewayAuthenticationError"];

const REQUEST_TIMEOUT = 408;

/**
 * Whether the call was turned away with a 4xx, so nothing was bought. A timeout (408), a 5xx, an
 * abort, a dropped connection and an unreadable reply may all have been charged, so they aren't.
 */
export function callRefused(err: unknown): boolean {
  const parsed = failedCall.safeParse(err);
  if (!parsed.success) return false;
  const { name, statusCode } = parsed.data;
  if (statusCode === undefined) return UNAUTHENTICATED.includes(name);
  return statusCode >= 400 && statusCode < 500 && statusCode !== REQUEST_TIMEOUT;
}
