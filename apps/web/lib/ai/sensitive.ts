// The code-side sensitive-trait filter (PRD C-8, T48). The extraction prompt
// already forbids these; this catches a slip. The list lives in code, not in
// settings, because it's a safety rule: changing it needs a review and a test.
// Whole words, case-insensitive. It errs safe: "church architecture" is blocked.

const TERMS: Record<string, string[]> = {
  health: [
    "arthritis", "diabetes", "diabetic", "cancer", "chemo", "chemotherapy", "medication", "medications",
    "meds", "prescription", "blood pressure", "hypertension", "depression", "anxiety", "adhd", "autism",
    "autistic", "disability", "disabled", "illness", "disease", "surgery", "dementia", "alzheimer's",
    "alzheimers", "medical", "diagnosis", "diagnosed", "hospital", "rehab", "sobriety", "sober",
  ],
  pregnancy: ["pregnant", "pregnancy", "trimester", "fertility", "ivf", "miscarriage", "expecting a baby"],
  religion: [
    "religion", "religious", "church", "temple", "mosque", "synagogue", "prayer", "pray", "praying",
    "bible", "quran", "koran", "torah", "christian", "catholic", "muslim", "islam", "islamic", "jewish",
    "hindu", "buddhist", "sikh", "diwali", "ramadan", "eid", "hanukkah", "passover", "lent", "faith",
  ],
  sexuality: [
    "gay", "lesbian", "bisexual", "queer", "transgender", "lgbt", "lgbtq", "lgbtq+", "sexuality",
    "sexual orientation",
  ],
  politics: [
    "democrat", "democrats", "democratic", "republican", "republicans", "liberal", "conservative",
    "maga", "political", "politics", "election", "vote", "votes", "voting", "voted",
  ],
  ethnicity: ["ethnicity", "ethnic", "racial"],
  finances: [
    "debt", "bankrupt", "bankruptcy", "salary", "income", "unemployed", "laid off", "loan", "loans",
    "mortgage", "credit score", "poverty", "can't afford", "cannot afford",
  ],
  grief: [
    "grief", "grieving", "mourning", "bereavement", "funeral", "passed away", "died", "death", "widow",
    "widowed", "widower", "late husband", "late wife",
  ],
};

const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");

// Word boundaries that also work around "+" and apostrophes.
const PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${Object.values(TERMS).flat().map(escape).join("|")})(?![\\p{L}\\p{N}])`,
  "iu",
);

/** True when a fact touches health, pregnancy, religion, sexuality, politics, ethnicity, finances or grief. */
export function isSensitive(value: string): boolean {
  return PATTERN.test(value);
}
