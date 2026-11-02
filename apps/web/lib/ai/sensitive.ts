// The code-side sensitive-trait filter (PRD C-8, T48). The extraction prompt
// already forbids these; this catches a slip. The list lives in code, not in
// settings, because it's a safety rule: changing it needs a review and a test.
// Whole words, case-insensitive. It errs safe: "church architecture" is blocked.

const TERMS: Record<string, string[]> = {
  health: [
    "arthritis", "diabetes", "diabetic", "cancer", "chemo", "chemotherapy", "medication", "medications",
    "meds", "prescription", "blood pressure", "hypertension", "depression", "anxiety", "adhd", "autism",
    "autistic", "disability", "disabled", "illness", "disease", "surgery", "dementia", "alzheimer's",
    "alzheimers", "medical", "diagnosis", "diagnosed", "hospital", "rehab", "sobriety", "insulin", "wheelchair",
    "hearing aid", "hearing aids", "cane", "knee replacement", "hip replacement", "physical therapy",
    "physiotherapy", "chronic pain",
  ],
  pregnancy: [
    "pregnant", "pregnancy", "trimester", "fertility", "ivf", "miscarriage", "expecting", "due in", "maternity",
    "newborn", "baby shower",
  ],
  religion: [
    "religion", "religious", "church", "temple", "mosque", "synagogue", "prayer", "pray", "praying",
    "bible", "quran", "koran", "torah", "christian", "catholic", "muslim", "islam", "islamic", "jewish",
    "hindu", "buddhist", "sikh", "diwali", "ramadan", "eid", "hanukkah", "passover", "lent", "faith", "kosher",
    "halal", "hijab", "rosary", "rosh hashanah", "yom kippur",
  ],
  sexuality: [
    "gay", "lesbian", "bisexual", "queer", "transgender", "lgbt", "lgbtq", "lgbtq+", "sexuality",
    "sexual orientation", "pride flag", "pride month",
  ],
  politics: [
    "democrat", "democrats", "democratic", "republican", "republicans", "maga", "political", "politics", "election", "vote", "votes", "voting", "voted",
  ],
  ethnicity: ["ethnicity", "ethnic", "racial"],
  finances: [
    "debt", "bankrupt", "bankruptcy", "salary", "income", "unemployed", "laid off", "loan", "loans",
    "mortgage", "credit score", "poverty", "can't afford", "cannot afford", "tight on money", "flat broke", "went broke",
  ],
  grief: [
    "grief", "grieving", "mourning", "bereavement", "funeral", "passed away", "died", "death", "widow",
    "widowed", "widower", "memorial",
  ],
};

// Grief said as "lost her husband" or "late mother".
const FAMILY = "(?:husband|wife|mother|father|mom|dad|son|daughter|brother|sister|partner)";
const PHRASES = [`late\\s+${FAMILY}`, `lost\\s+(?:her|his|their|my)\\s+${FAMILY}`];

// Ordinary gift facts that share a word with a topic above. Removed before matching.
const ALLOWED = [/candy\s+canes?/giu, /christian\s+(?:dior|louboutin)/giu, /death\s+metal/giu, /liberal\s+arts/giu, /praying\s+mantis/giu];

const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");

// Word boundaries that also work around "+" and apostrophes.
const PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${[...Object.values(TERMS).flat().map(escape), ...PHRASES].join("|")})(?![\\p{L}\\p{N}])`,
  "iu",
);

/** True when a fact touches health, pregnancy, religion, sexuality, politics, ethnicity, finances or grief. */
export function isSensitive(value: string): boolean {
  return PATTERN.test(ALLOWED.reduce((v, allowed) => v.replace(allowed, " "), value));
}
