import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { FACT_CATEGORIES_EXTRACTED, type FactCategory } from "@gifts-af/core";

// Capture extraction (ALL-25, design §6.2): page text, the buyer's note and the
// screenshot go in; schema-checked candidate facts come out. Prompt v3 from
// the W1-3 spike (design/spikes/ai.md) plus the ALL-25 rules on owning and padding.

export type CandidateFact = { category: FactCategory; value: string; confidence: number };

export type ExtractInput = {
  /** How the buyer knows them, e.g. "father". Never their name (T42). */
  relationship: string;
  url: string;
  title: string;
  text: string;
  note: string | null;
  /** The image and its media type (image/jpeg, png, webp or gif), or null when the capture has none. */
  screenshot: { bytes: Uint8Array; type: string } | null;
  /** What's already recorded about them, active or removed, as factLine text. */
  known: string[];
};

/** `timeoutMs` comes from the capture_extract_timeout_ms setting (T23). */
export type ExtractOptions = { timeoutMs: number };
/** `costCents`: what the Gateway said the call cost, fractions included; null when it didn't say. */
export type Reading = { facts: CandidateFact[]; costCents: number | null };
export type Extract = (input: ExtractInput, options: ExtractOptions) => Promise<Reading>;

const SYSTEM = `You help a gift-giving app learn what one specific person might like.
You get what the user captured from a web page about that person: the page text, a screenshot of what was on screen, and sometimes a note from the user.
Return candidate facts.

Categories: ${FACT_CATEGORIES_EXTRACTED.join(", ")}.
- value: short and specific ("fly tying", "a new rotary fly-tying vise", "film: Kodak Portra 400").
- confidence: 0 to 1, on this scale: 0.9 when the page says it outright; 0.7 when it's clearly implied, like posting about or sharing a page on a hobby; 0.5 or lower for a guess, a joke or something said in passing.
- evidence: the few words from the page that support it.
- "owns" and "wants" matter most: they stop duplicate gifts and point at real needs.
- Something the person is only seen with, using or wearing is "owns", never "interest" or "wants", unless the page says they want another one. A photo of someone with an Owala bottle means they already have one.
- Record what the page says before any gift idea it suggests: a complaint is a "dislike", and a guessed fix for it is a separate, lower-confidence "wants".
- Never return a fact that is already recorded about them, even in other words ("UCF t-shirt" and "UCF Knights pocket tee" are the same fact).
- If nothing is clear, return an empty list. Never pad it with weak guesses.

Never record or hint at sensitive traits: health or medical conditions, medications, pregnancy,
religion or religious practice, politics, sexuality, ethnicity, finances, or grief. If a sensitive
detail implies a practical gift constraint, record only the constraint in neutral words
(for example "prefers easy-open, large-grip items"), never the reason.
Record facts only about the person the capture is for, not about other people mentioned.
For the screenshot, use only what is visible (products, logos, brands, sizes); do not guess at what is off screen.`;

const schema = z.object({
  facts: z.array(
    z.object({
      category: z.enum(FACT_CATEGORIES_EXTRACTED),
      value: z.string().trim().min(1).max(200),
      confidence: z.number().min(0).max(1),
      evidence: z.string(),
    }),
  ),
});

// The Gateway reports a call's cost in dollars, as a string ("0.001966").
const gatewayCost = z.object({
  gateway: z.object({ cost: z.string().trim().min(1).pipe(z.coerce.number<string>().nonnegative()) }),
});

function reportedCents(providerMetadata: unknown): number | null {
  const parsed = gatewayCost.safeParse(providerMetadata);
  return parsed.success ? parsed.data.gateway.cost * 100 : null;
}

function who(relationship: string): string {
  return relationship === "other" || relationship === "" ? "someone they know" : `their ${relationship.replace(/_/g, " ")}`;
}

/** The model is built by the caller (a route or script), never here (E3). */
export function createExtractor(model: LanguageModel): Extract {
  return async (input, { timeoutMs }) => {
    const lines = [
      `This capture is about ${who(input.relationship)}.`,
      `Page: ${input.title}`,
      `URL: ${input.url}`,
      input.note ? `Note from the person who captured this: ${input.note}` : null,
      ...(input.known.length > 0 ? ["", "Already recorded about them:", ...input.known.map((line) => `- ${line}`)] : []),
      "",
      "Page text:",
      input.text,
    ].filter((l) => l !== null);

    const { output, providerMetadata } = await generateText({
      model,
      reasoning: "low",
      // One try within the time limit: the popup is waiting, and Try again is one tap away.
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(timeoutMs),
      system: SYSTEM,
      output: Output.object({ schema }),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: lines.join("\n") },
            ...(input.screenshot ? [{ type: "file" as const, mediaType: input.screenshot.type, data: input.screenshot.bytes }] : []),
          ],
        },
      ],
    });
    return {
      facts: output.facts.map(({ category, value, confidence }) => ({ category, value, confidence })),
      costCents: reportedCents(providerMetadata),
    };
  };
}
