import { describe, expect, it } from "vitest";
import { AiError, gatewayCredits, sendMessages, type GatewayHttp } from "../messages";

// The Gateway's plain-HTTP calls with a fake fetch (E5: never the real vendor).

const PRICES = { inputCentsPerToken: 0, outputCentsPerToken: 0, searchCents: 0 };
const signal = () => new AbortController().signal;

function http(reply: () => Response): GatewayHttp & { calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  return {
    base: "https://gateway.test",
    apiKey: "gw-key",
    calls,
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return reply();
    }) as typeof fetch,
  };
}

const status = (body: unknown, code: number) => () => new Response(JSON.stringify(body), { status: code });

async function thrown(p: Promise<unknown>): Promise<AiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AiError) return e;
    throw e;
  }
  throw new Error("expected an AiError");
}

describe("sendMessages", () => {
  it("a 402 throws AiError no_credit", async () => {
    for (const type of ["insufficient_funds", "quota_for_entity_exceeded"]) {
      const e = await thrown(sendMessages(http(status({ error: { type } }, 402)), {}, PRICES, signal()));
      expect(e.kind).toBe("no_credit");
      expect(e.message).toBe("AI credit is used up");
    }
    // Whatever the body says, or none at all.
    const bare = await thrown(sendMessages(http(() => new Response("", { status: 402 })), {}, PRICES, signal()));
    expect(bare.kind).toBe("no_credit");
  });

  it("a 500 is still unavailable", async () => {
    const e = await thrown(sendMessages(http(status({ error: { type: "internal" } }, 500)), {}, PRICES, signal()));
    expect(e.kind).toBe("unavailable");
  });

  it("the AiError message never holds the reply body", async () => {
    const secret = "acct-12345 has $0.00 left";
    for (const code of [402, 500]) {
      const e = await thrown(sendMessages(http(status({ error: { type: "insufficient_funds", message: secret } }, code)), {}, PRICES, signal()));
      expect(e.message).not.toContain("acct-12345");
      expect(JSON.stringify(e)).not.toContain("acct-12345");
    }
  });
});

describe("gatewayCredits", () => {
  it('gatewayCredits sends the bearer and reads "12.34" as 1234 cents', async () => {
    const h = http(status({ balance: "12.34", total_used: "7.66" }, 200));
    expect(await gatewayCredits(h, signal())).toEqual({ balanceCents: 1234 });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe("https://gateway.test/v1/credits");
    expect(new Headers(h.calls[0].init?.headers).get("authorization")).toBe("Bearer gw-key");
  });

  it('gatewayCredits throws malformed on {"balance":"n/a"}', async () => {
    const e = await thrown(gatewayCredits(http(status({ balance: "n/a", total_used: "0" }, 200)), signal()));
    expect(e.kind).toBe("malformed");
    const missing = await thrown(gatewayCredits(http(status({ total_used: "0" }, 200)), signal()));
    expect(missing.kind).toBe("malformed");
  });
});
