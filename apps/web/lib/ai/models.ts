// Which model each AI task uses (design §7, T11, T39). Changing one is a
// one-line change here, re-checked with `pnpm ai:eval`. IDs come from
// GET https://ai-gateway.vercel.sh/v1/models (dots, not dashes).
export const AI_MODELS = {
  extraction: "anthropic/claude-sonnet-5.5",
} as const;
