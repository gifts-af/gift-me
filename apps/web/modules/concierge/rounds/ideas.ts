import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { GenerateIdeas } from "./engine";

// A stand-in for the idea engine (ALL-27), which replaces this file and then
// switches the round engine on. Outside production it writes three sample
// ideas so a round can be run end to end; on production it refuses, so a
// round can never reach a buyer with made-up gifts.

const TITLES = ["Stoneware mug set", "Cast-iron herb planter", "Audiobook credits"];
// Sample prices only (no budget set): this file is deleted by ALL-27.
const NO_BUDGET_CENTS = [2500, 3500, 4500];
const BUDGET_SHARES = [0.6, 0.75, 0.9];

/** Three sample ideas, all within the budget when there is one. */
function sampleIdeas(budgetCents: number | null): { title: string; totalCents: number }[] {
  return TITLES.map((title, i) => ({
    title,
    totalCents: budgetCents === null ? NO_BUDGET_CENTS[i] : Math.floor((budgetCents * BUDGET_SHARES[i]) / 100) * 100,
  }));
}

export function createStubGenerateIdeas(opts: { production: boolean }): GenerateIdeas {
  return async (roundId) => {
    if (opts.production) throw new Error("Idea engine not built yet (ALL-27)");
    const concierge = createAdminClient().schema("concierge");

    const { data: round, error } = await concierge
      .from("gift_rounds")
      .select("user_id, budget_cents")
      .eq("id", roundId)
      .single();
    if (error) throw new Error(`Loading the round failed: ${error.message}`);

    // A retried step mustn't add a second set.
    const { count, error: countError } = await concierge
      .from("gift_ideas")
      .select("id", { count: "exact", head: true })
      .eq("round_id", roundId);
    if (countError) throw new Error(`Counting the round's ideas failed: ${countError.message}`);
    if (count) return;

    const { error: insertError } = await concierge.from("gift_ideas").insert(
      sampleIdeas(round.budget_cents).map((idea, i) => ({
        user_id: round.user_id,
        round_id: roundId,
        title: idea.title,
        price_cents: idea.totalCents,
        est_total_cents: idea.totalCents,
        rank: i + 1,
        source: "generated",
        status: "proposed",
      })),
    );
    if (insertError) throw new Error(`Saving sample ideas failed: ${insertError.message}`);
  };
}
