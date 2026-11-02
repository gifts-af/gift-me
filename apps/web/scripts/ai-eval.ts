// `pnpm ai:eval` (ALL-25, AC-1): runs capture extraction against the real
// model on every W1-3 fixture and checks the answer key in
// lib/ai/fixtures/expected.json. Costs about 10¢. Not run in CI.
//
// Needs AI_GATEWAY_API_KEY in apps/web/.env.development.local (`vercel env pull`,
// README > Environments). The two real-page screenshots aren't committed (the
// repo is public); `node spikes/ai/screens.mjs` recreates them, and missing
// ones are skipped with a note.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createExtractor, type CandidateFact } from "../lib/ai/extract";
import { keptForEval, matchesExpected, type Expected } from "../lib/ai/eval";
import { AI_MODELS } from "../lib/ai/models";

const web = path.resolve(__dirname, "..");
const fixtures = path.join(web, "lib/ai/fixtures");
const envFile = path.join(web, ".env.development.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.AI_GATEWAY_API_KEY) {
  console.error("AI_GATEWAY_API_KEY isn't set. Run `vercel env pull` in apps/web first (README > Environments).");
  process.exit(1);
}

// The app's settings value (capture_fact_min_confidence_pct); the spike used the same.
const MIN_CONFIDENCE_PCT = 60;
// The spike's people (spikes/ai/fixtures/people.json), by relationship only.
const RELATIONSHIP: Record<string, string> = { dad: "father", maya: "sister", june: "grandmother", sam: "brother", priya: "friend" };

type Capture = { id: string; person_id: string; source_url: string; page_title: string; text_excerpt: string };
type Screen = { file: string; person_id: string; source: string };

const read = <T>(file: string): T => JSON.parse(readFileSync(path.join(fixtures, file), "utf8")) as T;
const expected = read<Record<string, Expected>>("expected.json");
const captures = read<Capture[]>("captures.json");
const screens = read<Screen[]>("screens/manifest.json");
const extract = createExtractor(AI_MODELS.extraction);

type Row = { id: string; found: number; missing: string; forbidden: string; secs: string };
const rows: Row[] = [];
let failed = false;

async function check(id: string, run: () => Promise<CandidateFact[]>) {
  const started = Date.now();
  let facts: CandidateFact[];
  try {
    facts = keptForEval(await run(), MIN_CONFIDENCE_PCT);
  } catch (err) {
    failed = true;
    rows.push({ id, found: 0, missing: `error: ${err instanceof Error ? err.message : err}`, forbidden: "", secs: "" });
    return;
  }
  const { missing, forbidden } = matchesExpected(facts, expected[id]);
  if (missing.length > 0 || forbidden.length > 0) failed = true;
  rows.push({
    id,
    found: facts.length,
    missing: missing.map((m) => `${m.category.join("/")}: ${m.keywords.join(" ")}`).join("; "),
    forbidden: forbidden.join("; "),
    secs: ((Date.now() - started) / 1000).toFixed(1),
  });
}

async function main() {
  for (const c of captures) {
    await check(c.id, () =>
      extract({
        relationship: RELATIONSHIP[c.person_id],
        url: c.source_url,
        title: c.page_title,
        text: c.text_excerpt,
        note: null,
        screenshot: null,
      }),
    );
  }

  for (const s of screens) {
    const file = [path.join(fixtures, "screens", s.file), path.resolve(web, "../../spikes/ai/fixtures/screens", s.file)].find(existsSync);
    if (!file) {
      console.log(`skipped ${s.file}: not on disk (node spikes/ai/screens.mjs makes it)`);
      continue;
    }
    if (!expected[s.file]) continue;
    await check(s.file, () =>
      extract({
        relationship: RELATIONSHIP[s.person_id],
        url: "",
        title: s.source,
        text: "",
        note: null,
        screenshot: new Uint8Array(readFileSync(file)),
      }),
    );
  }

  console.log(`Model: ${AI_MODELS.extraction}, cut ${MIN_CONFIDENCE_PCT}%`);
  console.table(rows);
  console.log(failed ? "FAIL: see missing or forbidden above." : "PASS: every expected fact found, nothing forbidden.");
  process.exit(failed ? 1 : 0);
}

void main();
