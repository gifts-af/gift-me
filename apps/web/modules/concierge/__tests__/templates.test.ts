import { describe, expect, it } from "vitest";
import { SAMPLE_DATA, TEMPLATES, type NotificationKind } from "../notify/templates";

const kinds = Object.keys(SAMPLE_DATA) as NotificationKind[];

// store_cancelled_late: nothing more can ship in time, so there is nothing to tap (ALL-33 mock-up).
// gift_on_time and tracking_news: plain links only; nothing needs one main action.
const NO_BUTTON: NotificationKind[] = ["notes_tip", "who_is_this", "notes_not_read", "notes_cant_cancel", "store_cancelled_late", "gift_on_time", "tracking_news", "delivered", "reaction_prompt"];

/** The Zinc wallet address some emails carry as data rather than a one-time link. */
function walletUrl(kind: NotificationKind): string[] {
  const data = SAMPLE_DATA[kind].data as { walletUrl?: string };
  return data.walletUrl ? [data.walletUrl] : [];
}

// Typed loosely: the table is keyed per kind, the loop is generic.
function render(kind: NotificationKind) {
  const s = SAMPLE_DATA[kind];
  const fn = TEMPLATES[kind] as (d: unknown, l: unknown) => ReturnType<(typeof TEMPLATES)["test"]>;
  return fn(s.data, s.links);
}

describe.each(kinds)("template %s", (kind) => {
  const mail = render(kind);
  const urls = Object.values(SAMPLE_DATA[kind].links) as string[];

  it("has a subject", () => expect(mail.subject.length).toBeGreaterThan(0));
  it("has the logo, at most one button, 600px, inline styles only", () => {
    expect(mail.html).toContain("https://giftsaf.com/email-logo.png");
    // One teal button; anything else is a plain link (a hold's "Cancel this gift"). The notes
    // emails (ALL-31) have none: the tip is answered by replying, the choices are equal links.
    expect(mail.html.match(/background:#0f766e/g) ?? []).toHaveLength(NO_BUTTON.includes(kind) ? 0 : 1);
    expect(mail.html).toContain("max-width:600px");
    expect(mail.html).not.toContain("<style");
    expect(mail.html).not.toContain("class=");
  });
  it("lays out at the phone's width, not a 980px desktop width (ALL-60)", () => {
    expect(mail.html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(mail.html).toContain('<meta charset="utf-8">');
  });
  it("contains every link in html and text", () => {
    for (const u of [...urls, ...walletUrl(kind)]) {
      expect(mail.html).toContain(u);
      expect(mail.text).toContain(u);
    }
  });
});

describe("escaping", () => {
  it("escapes names in the HTML", () => {
    const s = SAMPLE_DATA.reminder;
    const mail = TEMPLATES.reminder({ ...s.data, personName: '<script>&"' }, s.links);
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;&amp;&quot;");
  });
});

describe("heads_up", () => {
  it("auto_buy names the gift and date and says how to skip", () => {
    const s = SAMPLE_DATA.heads_up;
    const mail = TEMPLATES.heads_up(
      { ...s.data, mode: "auto_buy", autoBuyIdea: "the stoneware mug set", autoBuyDate: "March 5" },
      { choose: s.links.choose, skip: "https://example.com/a/skip-token" },
    );
    for (const out of [mail.html, mail.text]) {
      expect(out).toContain("the stoneware mug set");
      expect(out).toContain("March 5");
      expect(out).toContain("To skip this gift");
      expect(out).toContain("Review or change");
    }
    expect(mail.html).toContain("https://example.com/a/skip-token");
    expect(mail.html.match(/<a[\s>]/g)).toHaveLength(1);
    expect(mail.html).not.toContain("Nothing is bought until you choose.");
  });

  it("reminder mode says nothing is bought until you choose", () => {
    const s = SAMPLE_DATA.heads_up;
    const mail = TEMPLATES.heads_up(s.data, s.links);
    expect(mail.html).toContain("Nothing is bought until you choose.");
    expect(mail.text).toContain("Nothing is bought until you choose.");
  });
});

describe("skipped", () => {
  it("says nothing was bought, what happens next, and has one button; no apology when nobody chose", () => {
    const s = SAMPLE_DATA.skipped;
    const mail = TEMPLATES.skipped(s.data, s.links);
    expect(mail.subject).toBe("No gift for Mom's birthday this time");
    expect(mail.text).toContain(
      "No gift was chosen for Mom's birthday on Saturday, March 14, so we didn't buy anything and you haven't been charged.",
    );
    expect(mail.text).toContain(
      "What happens next: You can still pick something up yourself. We'll be in touch before Mom's next occasion.",
    );
    expect(mail.text).not.toContain("sorry");
    expect(mail.html).toContain("Open Mom&#39;s page");
    expect(mail.html.match(/<a[\s>]/g)).toHaveLength(1);
  });
});

// ─── ALL-116: bad news says sorry, what it means, what was charged, and what happens next ───

describe.each([
  "skipped-held",
  "skipped-partial",
  "needs_attention",
  "price_up",
  "out_of_stock",
  "too_late",
  "missed_on_us",
  "failed_late",
  "failed_several",
  "hold_funds",
  "hold_setup",
  "hold_address",
  "hold_trouble",
  "hold_unconfirmed",
  "no_ideas",
] as const)("bad news: %s", (name) => {
  const mail = (() => {
    const s = SAMPLE_DATA.skipped;
    if (name === "skipped-held") return TEMPLATES.skipped({ ...s.data, held: true }, s.links);
    if (name === "skipped-partial") {
      return TEMPLATES.skipped({ ...s.data, held: true, partial: { cancelled: ["Linen apron"], onItsWay: ["Mug"] } }, s.links);
    }
    return render(name);
  })();
  it("apologizes, says what was charged, and says what happens next", () => {
    expect(mail.text).toMatch(/sorry/i);
    expect(mail.text).toMatch(/haven't been charged|won't be charged/);
    expect(mail.text).toContain("What happens next:");
  });
});

describe("final_notice", () => {
  it("names the order-by time instead of claiming it's the last day", () => {
    const s = SAMPLE_DATA.final_notice;
    const mail = TEMPLATES.final_notice({ ...s.data, orderByText: "Thursday, March 12" }, s.links);
    expect(mail.text).not.toContain("last day");
    expect(mail.text).toContain("Choose a gift by Thursday, March 12 so it arrives in time.");
  });
});

describe("heads_up late", () => {
  it("adds the time-is-short line only when late", () => {
    const s = SAMPLE_DATA.heads_up;
    const line = "Mom's birthday is close, so we've kept only gifts that can still arrive in time.";
    expect(TEMPLATES.heads_up({ ...s.data, late: true }, s.links).text).toContain(line);
    expect(TEMPLATES.heads_up(s.data, s.links).text).not.toContain(line);
    const auto = { ...s.data, mode: "auto_buy" as const, autoBuyIdea: "x", autoBuyDate: "y", late: true };
    expect(TEMPLATES.heads_up(auto, s.links).text).toContain(line);
  });
});

describe("needs_address reminder", () => {
  it("adds the reminder line only when it's a reminder", () => {
    const s = SAMPLE_DATA.needs_address;
    const line = "A reminder: we still need Mom's address to find gifts that arrive by Saturday, March 14.";
    expect(TEMPLATES.needs_address({ ...s.data, reminder: true }, s.links).text).toContain(line);
    expect(TEMPLATES.needs_address(s.data, s.links).text).not.toContain("A reminder");
  });
});

describe("guided questions link (ALL-26 AC-10)", () => {
  const QUESTIONS_URL = "https://example.com/a/questions-token";

  it.each(["heads_up", "reminder"] as const)("%s shows it under the one button, in html and text", (kind) => {
    const s = SAMPLE_DATA[kind];
    const render = TEMPLATES[kind] as (d: unknown, l: unknown) => { html: string; text: string };
    const mail = render({ ...s.data, questions: 3 }, { ...s.links, questions: QUESTIONS_URL });
    expect(mail.html).toContain(QUESTIONS_URL);
    expect(mail.text).toContain(`Answer 3 quick questions about Mom: ${QUESTIONS_URL}`);
    // The button, the questions link, and a Buy this link per idea (ALL-29).
    expect(mail.html.match(/<a[\s>]/g)).toHaveLength(2 + 3);
    expect(mail.html.match(/background:#0f766e/g)).toHaveLength(1);
    expect(mail.html.indexOf(s.links.choose)).toBeLessThan(mail.html.indexOf(QUESTIONS_URL));
  });

  it("says question, not questions, for one", () => {
    const s = SAMPLE_DATA.reminder;
    const mail = TEMPLATES.reminder({ ...s.data, questions: 1 }, { ...s.links, questions: QUESTIONS_URL });
    expect(mail.text).toContain("Answer 1 quick question about Mom");
  });

  it("the auto-buy heads-up shows it too", () => {
    const s = SAMPLE_DATA.heads_up;
    const data = { ...s.data, mode: "auto_buy" as const, autoBuyIdea: "A mug", autoBuyDate: "Mar 1", questions: 2 };
    expect(TEMPLATES.heads_up(data, { ...s.links, questions: QUESTIONS_URL }).html).toContain(QUESTIONS_URL);
  });

  it("is absent without one", () => {
    const s = SAMPLE_DATA.reminder;
    expect(TEMPLATES.reminder(s.data, s.links).text).not.toContain("quick question");
  });
});

// ─── ALL-32: holds and failures (approved mock-ups, design/mockups/ALL-32-emails*.html) ───

const HOLDS = ["hold_funds", "hold_setup", "hold_address", "hold_trouble"] as const;

describe.each(HOLDS)("hold email %s", (kind) => {
  const mail = render(kind);
  it("says the cost plainly, with no Alpha label (ALL-114), and a plain cancel link under the button", () => {
    const cancel = (SAMPLE_DATA[kind].links as { cancel: string }).cancel;
    expect(mail.text).toMatch(/we'll buy the gift: its price plus Zinc's \$1 fee\./);
    expect(mail.text).toContain(`Changed your mind? Cancel this gift: ${cancel}`);
    expect(mail.html.match(/<a[\s>]/g)).toHaveLength(2);
  });
});

it("no email says Alpha (ALL-114)", () => {
  for (const kind of kinds) expect(render(kind).text).not.toContain("Alpha");
});

describe("failed_late (a failure after the round closed, or untold when it closed)", () => {
  it("one gift: sorry, why, nothing charged, and too late to choose again", () => {
    const mail = render("failed_late");
    expect(mail.subject).toBe("We're sorry, we couldn't buy Mom's gift");
    expect(mail.text).toContain(
      "We know you were counting on the Le Creuset mug set for Mom's birthday on Saturday, March 14, and we're sorry it didn't work out. The store ran out. You haven't been charged for it.",
    );
    expect(mail.text).toContain(
      "What happens next: it's too late for us to send another gift in time, but you can still pick something up yourself. This round is now closed.",
    );
    expect(mail.text).toContain("Open Mom's page:");
  });

  it("says the store couldn't place it when the reason isn't known", () => {
    const s = SAMPLE_DATA.failed_late;
    const mail = TEMPLATES.failed_late({ ...s.data, failed: [{ title: "Mug" }] }, s.links);
    expect(mail.text).toContain("The store couldn't place the order. You haven't been charged for it.");
  });

  it("names a gift of the round that is on its way", () => {
    const s = SAMPLE_DATA.failed_late;
    const mail = TEMPLATES.failed_late({ ...s.data, onItsWay: ["Linen apron"] }, s.links);
    expect(mail.text).toContain("The Linen apron is ordered and on its way.");
  });

  it("several gifts: one email, a row with the reason for each (AC-15)", () => {
    const s = SAMPLE_DATA.failed_late;
    const failed = [
      { title: "Mug", detail: "The price went up more than you allowed for." },
      { title: "Apron", detail: "The store ran out." },
    ];
    const mail = TEMPLATES.failed_late({ ...s.data, failed }, s.links);
    expect(mail.subject).toBe("We're sorry, we couldn't buy 2 of Mom's birthday gifts");
    expect(mail.text).toContain("- Mug (The price went up more than you allowed for.)");
    expect(mail.text).toContain("- Apron (The store ran out.)");
    expect(mail.text).toContain("You haven't been charged for them.");
  });
});

describe("failed_several (ALL-116: two or more failed while the round is open)", () => {
  const s = SAMPLE_DATA.failed_several;
  it("says how many were tried and failed, names what's on its way, and a row and link per gift", () => {
    const mail = TEMPLATES.failed_several(s.data, s.links);
    expect(mail.subject).toBe("Sorry, 2 of Mom's birthday gifts couldn't be bought");
    expect(mail.text).toContain(
      "We're sorry. We tried to order 3 gifts for Mom's birthday on Saturday, March 14, and 2 of them didn't go through. You haven't been charged for either.",
    );
    expect(mail.text).toContain("The good news: the Cast-iron herb planter is ordered and on its way.");
    expect(mail.text).toContain("- Le Creuset mug set (The price went up more than you allowed for. Approve the new price, or choose another gift.)");
    expect(mail.text).toContain(`Review the new price for the Le Creuset mug set: ${s.data.failed[0].url}`);
    expect(mail.text).toContain(`Choose another gift instead of the Linen apron: ${s.data.failed[1].url}`);
    expect(mail.text).toContain("Choose by Thursday, March 5 so it arrives in time.");
    expect(mail.html.match(/background:#0f766e/g)).toHaveLength(1);
  });

  it("says neither when both of two failed, and leaves out the good news when nothing is on its way", () => {
    const mail = TEMPLATES.failed_several({ ...s.data, tried: 2, onItsWay: undefined }, s.links);
    expect(mail.text).toContain("and neither of them went through. You haven't been charged for either.");
    expect(mail.text).not.toContain("good news");
  });

  it("says none, and them, when three of three failed", () => {
    const three = [...s.data.failed, { title: "Vase", detail: "The store ran out. Choose another gift.", url: "https://example.com/rounds/r1/fix/o3" }];
    const mail = TEMPLATES.failed_several({ ...s.data, tried: 3, failed: three, onItsWay: undefined }, s.links);
    expect(mail.text).toContain("and none of them went through. You haven't been charged for them.");
  });
});

describe("a failure email names the round's other gifts that were ordered", () => {
  type Others = { onItsWay?: string[]; ordering?: string[]; arrived?: string[]; working?: string[] };
  const textFor = (kind: "price_up" | "out_of_stock" | "too_late", d: Others) => TEMPLATES[kind]({ ...SAMPLE_DATA[kind].data, ...d }, SAMPLE_DATA[kind].links).text;

  it.each(["price_up", "out_of_stock", "too_late"] as const)("%s: a placed gift, one still being ordered, both, and none", (kind) => {
    expect(textFor(kind, { onItsWay: ["Linen apron"] })).toContain("The good news: the Linen apron is ordered and on its way.");
    expect(textFor(kind, { ordering: ["Linen apron"] })).toContain(
      "The good news: we're ordering the Linen apron, and we'll email you as soon as the store confirms it.",
    );
    const both = textFor(kind, { onItsWay: ["Linen apron"], ordering: ["Tote", "Vase"] });
    expect(both).toContain("The good news: the Linen apron is ordered and on its way.");
    expect(both).toContain("We're ordering the Tote and the Vase, and we'll email you as soon as the store confirms them.");
    expect(textFor(kind, {})).not.toContain("good news");
  });

  it.each(["price_up", "out_of_stock", "too_late"] as const)("%s: what else is bought depends on the other gifts", (kind) => {
    const alone = textFor(kind, {});
    expect(alone).toContain("Nothing is bought until you choose.");
    expect(alone).toContain("you haven't been charged for it.");
    for (const d of [{ onItsWay: ["Tote"] }, { ordering: ["Tote"] }, { arrived: ["Tote"] }]) {
      expect(textFor(kind, d)).toContain("Nothing else is bought until you choose.");
    }
    // One that may be bought any moment: nothing is promised about buying.
    const working = textFor(kind, { working: ["Tote", "Vase"] });
    expect(working).toContain("We're still working on the Tote and the Vase.");
    expect(working).not.toMatch(/is bought until/);
    expect(textFor(kind, { arrived: ["Tote"] })).toContain("The good news: the Tote has arrived.");
    expect(textFor(kind, { arrived: ["Tote", "Vase"], onItsWay: ["Mug"] })).toContain("The Tote and the Vase have arrived.");
  });

  it("needs_attention and failed_several say what we're still working on instead of that nothing is bought", () => {
    const a = SAMPLE_DATA.needs_attention;
    const one = TEMPLATES.needs_attention({ ...a.data, working: ["Tote"] }, a.links).text;
    expect(one).toContain("What happens next: we're still working on the Tote. Choose another gift by");
    expect(one).not.toMatch(/is bought until/);
    const s = SAMPLE_DATA.failed_several;
    const several = TEMPLATES.failed_several({ ...s.data, working: ["Tote"] }, s.links).text;
    expect(several).toContain("We're still working on the Tote.");
    expect(several).not.toMatch(/is bought until/);
  });

  it("needs_attention and failed_several too", () => {
    const a = SAMPLE_DATA.needs_attention;
    expect(TEMPLATES.needs_attention({ ...a.data, ordering: ["Tote"] }, a.links).text).toContain("The good news: we're ordering the Tote");
    const s = SAMPLE_DATA.failed_several;
    expect(TEMPLATES.failed_several({ ...s.data, onItsWay: undefined, ordering: ["Tote"] }, s.links).text).toContain("The good news: we're ordering the Tote");
  });
});

describe.each(["hold_unconfirmed", "price_up", "out_of_stock", "too_late", "missed_on_us", "ordered", "failed_late", "failed_several"] as const)("%s", (kind) => {
  it("has no cancel link", () => {
    expect(render(kind).text).not.toContain("Cancel this gift");
  });
});

describe("hold_funds", () => {
  const s = SAMPLE_DATA.hold_funds;
  it("says what Zinc needs, what they have and the shortfall, and links the wallet", () => {
    const mail = TEMPLATES.hold_funds(s.data, s.links);
    expect(mail.subject).toBe("Sorry, Mom's gift is waiting on your Zinc balance");
    expect(mail.text).toContain("Sorry, we couldn't buy Mom's gift yet");
    expect(mail.text).toContain(
      "Sorry for the hold-up. You chose the Le Creuset mug set for Mom's birthday on Saturday, March 14, and there isn't enough in your Zinc balance to buy it yet. You haven't been charged.",
    );
    expect(mail.text).toContain(
      "Zinc needs $46.20 (the gift with room for a small price change, plus Zinc's $1 fee). You have $12, so you're $34.20 short.",
    );
    expect(mail.text).toContain("What happens next: add funds in Zinc and we'll buy it as soon as we see them, usually within a day.");
    expect(mail.text).toContain(`Top up your Zinc balance: ${s.data.walletUrl}`);
    expect(mail.text).toContain(
      "Topping up means we'll buy the gift: its price plus Zinc's $1 fee. To avoid this next time, turn on auto top-up in Zinc.",
    );
  });

  it("says still short after a partial top-up, and names a gift already on its way", () => {
    const mail = TEMPLATES.hold_funds({ ...s.data, still: true, placedTitle: "Linen apron" }, s.links);
    expect(mail.subject).toBe("You're still $34.20 short for Mom's gift");
    expect(mail.text).toContain("so you're still $34.20 short.");
    expect(mail.text).toContain("The Linen apron is on its way.");
  });

  it("says them for two gifts", () => {
    const mail = TEMPLATES.hold_funds({ ...s.data, giftTitles: ["Mug", "Apron"] }, s.links);
    expect(mail.text).toContain("You chose the Mug and the Apron for Mom's birthday");
    expect(mail.text).toContain("to buy them yet");
  });
});

describe("the other gift emails match the approved wording (ALL-116)", () => {
  it("hold_setup", () => {
    const mail = render("hold_setup");
    expect(mail.subject).toBe("Finish setting up payment to send Mom's gift");
    expect(mail.text).toContain("but payment isn't set up yet, so we couldn't buy it. You haven't been charged.");
    expect(mail.text).toContain("Connect Zinc and add your phone in Settings.");
    expect(mail.text).toContain("Finish setup:");
  });

  it("hold_address", () => {
    const mail = render("hold_address");
    expect(mail.subject).toBe("Sorry, Mom's gift needs an address");
    expect(mail.text).toContain(
      "You chose the Le Creuset mug set for Mom's birthday on Saturday, March 14, but we don't have an address we can ship to, so we haven't bought it yet.",
    );
    expect(mail.text).toContain("Fix the address:");
  });

  it("price_up", () => {
    const mail = render("price_up");
    expect(mail.subject).toBe("Sorry, the price of Mom's gift went up");
    expect(mail.text).toContain(
      "We're sorry. The price of the Le Creuset mug set for Mom's birthday on Saturday, March 14 went up more than you allowed for, so we didn't buy it and you haven't been charged for it.",
    );
    expect(mail.text).toContain("Review the gift:");
    expect(mail.text).toContain("Nothing is bought until you choose. Choose by Thursday, March 5 so it arrives in time.");
  });

  it("out_of_stock", () => {
    const mail = render("out_of_stock");
    expect(mail.text).toContain("The store ran out of the Le Creuset mug set for Mom's birthday on Saturday, March 14, so we didn't buy it");
    expect(mail.text).toContain("choose another gift by Thursday, March 5 and we'll send it in time.");
    expect(mail.text).toContain("Choose another gift:");
  });

  it("too_late", () => {
    const mail = render("too_late");
    expect(mail.subject).toBe("Sorry, Mom's gift can't arrive in time");
    expect(mail.text).toContain("you can still choose something that ships faster, by Thursday, March 5.");
    expect(mail.text).toContain("See faster gifts:");
  });

  it("needs_attention: the one button opens the gift's fix page and says so", () => {
    const s = SAMPLE_DATA.needs_attention;
    const mail = TEMPLATES.needs_attention(s.data, { open: "https://example.com/rounds/r1/fix/o1" });
    expect(mail.text).toContain("Review the gift: https://example.com/rounds/r1/fix/o1");
    expect(mail.html).toMatch(/background:#0f766e[^>]*>Review the gift</);
    expect(mail.text).not.toContain("Open Mom's page");
  });

  it("needs_attention: says when to choose again, or what happens next once there's nothing to choose", () => {
    const s = SAMPLE_DATA.needs_attention;
    expect(TEMPLATES.needs_attention(s.data, s.links).text).toContain("Choose another gift by Thursday, March 5 so it arrives in time.");
    expect(TEMPLATES.needs_attention({ ...s.data, orderByText: undefined }, s.links).text).toContain(
      "What happens next: You can still pick something up yourself.",
    );
  });

  it("hold_unconfirmed", () => {
    const mail = render("hold_unconfirmed");
    expect(mail.subject).toBe("We're confirming Mom's gift with the store");
    expect(mail.text).toContain("we'll email you as soon as we know. You won't be charged twice.");
    expect(mail.text).toContain("Open Mom's page:");
  });

  it("hold_trouble", () => {
    const mail = render("hold_trouble");
    expect(mail.subject).toBe("Sorry, we're having trouble ordering Mom's gift");
    expect(mail.text).toContain("Sorry, we're still trying to order Mom's gift");
  });

  it("missed_on_us: on us, sorry, nothing bought or charged (owner)", () => {
    const mail = render("missed_on_us");
    expect(mail.subject).toBe("We're sorry, we couldn't send Mom's gift in time");
    expect(mail.text).toContain(
      "A problem on our side stopped us placing the order before it was too late to arrive.\n\nThat's on us, and we're sorry. Nothing was bought and you haven't been charged.",
    );
    expect(mail.text).toContain("What happens next: we're looking into what went wrong.");
    expect(mail.text).toContain("Open Mom's page:");
  });

  it("skipped says a chosen gift wasn't bought, when one was held", () => {
    const s = SAMPLE_DATA.skipped;
    const mail = TEMPLATES.skipped({ ...s.data, held: true }, s.links);
    expect(mail.text).not.toContain("No gift was chosen");
    expect(mail.subject).toBe("Sorry, we couldn't buy Mom's gift in time");
    expect(mail.text).toContain(
      "We're sorry. The gift you chose for Mom's birthday on Saturday, March 14 couldn't be bought in time, so we didn't buy it and you haven't been charged.",
    );
  });
});

describe("heads_up's subject says where the gifts came from", () => {
  const idea = { title: "Fly rod", price: "$40" };
  const subject = (n: number, allFromList?: boolean) =>
    TEMPLATES.heads_up(
      { personName: "Jenn", occasion: "Christmas", dateText: "Fri, Dec 25", mode: "reminder", ideas: Array.from({ length: n }, () => idea), ...(allFromList ? { allFromList } : {}) },
      { choose: "https://x.test/r", ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`buy${i}`, "https://x.test/b"])) },
    ).subject;

  it.each([
    [3, true, "Jenn's Christmas: 3 gifts from their list"],
    [1, true, "Jenn's Christmas: 1 gift from their list"],
    [3, undefined, "Jenn's Christmas: 3 gift ideas"],
    [1, undefined, "Jenn's Christmas: 1 gift idea"],
  ])("%i, all from the list: %s", (n, list, want) => expect(subject(n, list)).toBe(want));
});

// ALL-167: these open the gift's own page; the skipped emails with nothing on the way stay on the person's.
describe("the button to the gift", () => {
  const link = { open: "https://example.com/rounds/r1" };
  it.each([
    ["ordered", TEMPLATES.ordered(SAMPLE_DATA.ordered.data, link)],
    ["several failures", TEMPLATES.failed_several(SAMPLE_DATA.failed_several.data, link)],
    ["a cancelled gift next to one on its way", TEMPLATES.skipped({ ...SAMPLE_DATA.skipped.data, held: true, partial: { cancelled: ["Apron"], onItsWay: ["Mug"] } }, link)],
  ])("%s: See Mom's gift", (_what, mail) => {
    expect(mail.text).toContain("See Mom's gift: https://example.com/rounds/r1");
    expect(mail.text).not.toContain("Open Mom's page");
  });

  it.each([false, true])("skipped (held: %s) opens their page", (held) => {
    expect(TEMPLATES.skipped({ ...SAMPLE_DATA.skipped.data, held }, link).text).toContain("Open Mom's page");
  });
});

describe("ordered (PRD A-8, owner)", () => {
  it("says it's ordered and where it's going, city only, with one button", () => {
    const mail = render("ordered");
    expect(mail.subject).toBe("Mom's gift is ordered");
    expect(mail.text).toContain(
      "We ordered the Le Creuset mug set for Mom's birthday on Saturday, March 14. It's on its way to Dayton.",
    );
    // There is no shipped email, so none is promised.
    expect(mail.text).not.toContain("ships");
    expect(mail.text).toContain("See Mom's gift:");
    expect(mail.html.match(/<a[\s>]/g)).toHaveLength(1);
  });

  it("leaves the place out when the city isn't known", () => {
    const s = SAMPLE_DATA.ordered;
    expect(TEMPLATES.ordered({ ...s.data, cityText: undefined }, s.links).text).toContain("It's on its way.");
  });
});

describe("skipped, partly (a held gift cancelled at the deadline next to one on its way)", () => {
  it("says which was cancelled, that nothing was charged for it, and which is on its way", () => {
    const s = SAMPLE_DATA.skipped;
    const mail = TEMPLATES.skipped({ ...s.data, held: true, partial: { cancelled: ["Linen apron"], onItsWay: ["Le Creuset mug set"] } }, s.links);
    expect(mail.text).toContain(
      "We're sorry. We couldn't buy the Linen apron for Mom's birthday in time, so we cancelled it. You haven't been charged for it.",
    );
    expect(mail.text).toContain("The good news: the Le Creuset mug set is ordered and on its way.");
    expect(mail.text).toContain("What happens next: you can still pick something up yourself in its place.");
    expect(mail.text).not.toContain("No gift");
  });

  it("says nothing about a gift that isn't confirmed yet", () => {
    const s = SAMPLE_DATA.skipped;
    const mail = TEMPLATES.skipped({ ...s.data, held: true, partial: { cancelled: ["Linen apron"], onItsWay: [] } }, s.links);
    expect(mail.text).toContain("Sorry, we had to cancel one of Mom's gifts");
    expect(mail.text).toContain("so we cancelled it. You haven't been charged for it.");
    expect(mail.text).not.toContain("on its way");
  });
});

describe("heads_up funding warning (AC-11)", () => {
  const s = SAMPLE_DATA.heads_up;
  const funding = {
    dueText: "$160",
    haveText: "$40",
    atLeast: false,
    windowText: "the next 3 weeks",
    walletUrl: "https://zinc.test/wallet",
  };

  it("is there only with funding, with the top-up link under the button", () => {
    const plain = TEMPLATES.heads_up(s.data, s.links);
    expect(plain.text).not.toContain("Zinc");
    const warned = TEMPLATES.heads_up({ ...s.data, funding }, s.links);
    expect(warned.text).toContain(
      "Your Zinc balance is low. $160 in gifts are due in the next 3 weeks, and you have $40. Add funds or turn on auto top-up in Zinc so nothing waits.",
    );
    expect(warned.text).toContain("Top up your Zinc balance: https://zinc.test/wallet");
    expect(warned.html.match(/background:#0f766e/g)).toHaveLength(1);
    expect(warned.html.indexOf(s.links.choose)).toBeLessThan(warned.html.indexOf("https://zinc.test/wallet"));
  });

  it("says at least when some rounds have no budget", () => {
    const warned = TEMPLATES.heads_up({ ...s.data, funding: { ...funding, atLeast: true } }, s.links);
    expect(warned.text).toContain("At least $160 in gifts are due");
  });
});

// ALL-31: emailed notes. Copy from design/plans/ALL-31-email-capture.md > How it works.
describe("notes emails (ALL-31)", () => {
  const both = (m: { html: string; text: string }) => [m.html, m.text];

  it("notes_tip names the person and says to reply (AC-15)", () => {
    const mail = TEMPLATES.notes_tip({ personName: "Dad" }, {});
    expect(mail.subject).toContain("Dad");
    for (const out of both(mail)) {
      expect(out).toContain("Did you know?");
      expect(out).toMatch(/Reply to this with anything you learn about Dad, like (&quot;|")wants a new fly rod(&quot;|"), and we(&#39;|')ll remember it\./);
    }
  });

  it("who_is_this has one link per choice, in order, plus Someone else (AC-3)", () => {
    const links = { choice0: "https://x.test/a/t0", choice1: "https://x.test/a/t1", someoneElse: "https://x.test/people" };
    const mail = TEMPLATES.who_is_this({ subject: "Fly rod", choices: [{ name: "Dad" }, { name: "Uncle Bob" }] }, links);
    expect(mail.subject).toBe("Who is your note about?");
    expect(mail.text).toContain("Dad: https://x.test/a/t0");
    expect(mail.text).toContain("Uncle Bob: https://x.test/a/t1");
    expect(mail.text).toContain("Someone else: https://x.test/people");
    expect(mail.text.indexOf("Dad:")).toBeLessThan(mail.text.indexOf("Uncle Bob:"));
    for (const out of both(mail)) expect(out).toMatch(/Fly rod/);
    expect(mail.html).toContain('href="https://x.test/people"');
  });

  it("who_is_this refuses a choice with no link, rather than sending href=undefined", () => {
    const render = () =>
      TEMPLATES.who_is_this({ subject: "x", choices: [{ name: "Dad" }, { name: "Mom" }] }, { choice0: "u0", someoneElse: "up" });
    expect(render).toThrow("no link for choice 1");
  });

  it("who_is_this says each name works once", () => {
    const s = SAMPLE_DATA.who_is_this;
    expect(TEMPLATES.who_is_this(s.data, s.links).text).toContain("Each name works once.");
  });

  it("who_is_this reads well with no subject", () => {
    const mail = TEMPLATES.who_is_this({ subject: "", choices: [{ name: "Dad" }] }, { choice0: "u0", someoneElse: "up" });
    expect(mail.text).not.toContain('""');
    expect(mail.text).toContain("couldn't tell who it's about");
  });

  it("notes_not_read says notes are read only for test accounts during the alpha (AC-10)", () => {
    const mail = TEMPLATES.notes_not_read({}, {});
    for (const out of both(mail)) {
      expect(out).toContain("only for test accounts during the alpha");
      expect(out).toMatch(/didn(&#39;|')t keep or read/);
    }
  });

  it("notes_cant_cancel says replies can't cancel a gift and points to the email's button (AC-14)", () => {
    const mail = TEMPLATES.notes_cant_cancel({}, {});
    for (const out of both(mail)) {
      expect(out).toMatch(/We saved your note/);
      expect(out).toMatch(/can(&#39;|')t cancel a gift/);
      expect(out).toContain("use the button in the email about it");
    }
  });
});

// ─── ALL-27: a round that couldn't get gift ideas, and ideas over the budget ───

describe("no_ideas (ALL-27 AC-9)", () => {
  const links = { questions: "https://x.test/a/questions" };

  it("no_ideas says sorry, nothing was charged, and links the questions", () => {
    const mail = TEMPLATES.no_ideas({ personName: "Mom", again: false }, links);
    expect(mail.subject).toBe("Sorry, we couldn't get gift ideas for Mom yet");
    expect(mail.text).toMatch(/sorry/i);
    // True whether nothing fit, a service was down, or we know too little about them.
    expect(mail.text).toContain("We don't have gift ideas for Mom yet.");
    expect(mail.text).not.toContain("couldn't find");
    expect(mail.text).toContain("haven't been charged");
    expect(mail.text).toContain("What happens next: telling us more about Mom helps. We'll try once more after you add something.");
    expect(mail.text).toContain("Tell us more about Mom");
    expect(mail.text).toContain("before the date passes");
    expect(mail.html).toContain('href="https://x.test/a/questions"');
    expect(mail.html.match(/background:#0f766e/g)).toHaveLength(1);
  });

  it("the again version says it tried with the new facts", () => {
    const mail = TEMPLATES.no_ideas({ personName: "Mom", again: true }, links);
    expect(mail.subject).toBe("Sorry, we couldn't get gift ideas for Mom yet");
    expect(mail.text).toContain("We tried again and still couldn't find a good fit for Mom.");
    expect(mail.text).toContain("haven't been charged");
    // It promises no retry: the extra run may already be spent.
    expect(mail.text).toContain(
      "What happens next: we'll skip this occasion. Telling us more about Mom helps us next time.",
    );
    expect(mail.text).not.toMatch(/try (one last time|once more|again after)/);
    expect(mail.text).toContain("Tell us more about Mom");
    expect(mail.html).toContain('href="https://x.test/a/questions"');
    expect(mail.text).not.toContain("try once more");
  });
});

describe("over-budget ideas (ALL-27)", () => {
  const ideas = [
    { title: "Stoneware mug set", price: "$42" },
    { title: "Espresso machine", price: "$95", overBudget: true },
  ];

  it("an over-budget idea is labeled in the heads-up", () => {
    const s = SAMPLE_DATA.heads_up;
    const mail = TEMPLATES.heads_up({ ...s.data, mode: "reminder", ideas }, s.links);
    expect(mail.text).toContain("- Espresso machine · $95 (Over budget)");
    expect(mail.text).toContain("- Stoneware mug set · $42\n");
    expect(mail.html).toContain("Over budget");
  });

  it("and in the reminders", () => {
    const s = SAMPLE_DATA.reminder;
    expect(TEMPLATES.reminder({ ...s.data, ideas }, s.links).text).toContain("Espresso machine · $95 (Over budget)");
    const f = SAMPLE_DATA.final_notice;
    expect(TEMPLATES.final_notice({ ...f.data, ideas }, f.links).text).toContain("Espresso machine · $95 (Over budget)");
  });
});

// ─── ALL-29: Buy this links ───

describe("the approval emails link each idea (ALL-29 AC-1)", () => {
  const BUY = (i: number) => `https://example.com/rounds/r1/buy?ideas=i${i}`;
  const links = { choose: "https://example.com/rounds/r1", buy0: BUY(0), buy1: BUY(1), buy2: BUY(2) };

  it("the heads-up has a Buy this link per idea and one button to the round screen", () => {
    const s = SAMPLE_DATA.heads_up;
    const mail = TEMPLATES.heads_up(s.data, links);
    expect(mail.html.match(/Buy this/g)).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(mail.html).toContain(`href="${BUY(i)}"`);
      expect(mail.text).toContain(`Buy this ›: ${BUY(i)}`);
    }
    expect(mail.html.match(/background:#0f766e/g)).toHaveLength(1);
    expect(mail.html).toMatch(/background:#0f766e[^>]*>Pick several or none of these</);
    expect(mail.html).toContain('href="https://example.com/rounds/r1"');
    expect(mail.text).toContain("Pick several or none of these: https://example.com/rounds/r1");
  });

  it("each row shows when it arrives, the store and the reason", () => {
    const s = SAMPLE_DATA.heads_up;
    const mail = TEMPLATES.heads_up(s.data, links);
    expect(mail.text).toContain("- Stoneware mug set · $42 (Arrives by Mar 5 · Amazon)");
    expect(mail.text).toContain("Loves tea.");
    expect(mail.html).toContain("font-style:italic");
  });

  it("an over-budget idea says so beside its arrival", () => {
    const s = SAMPLE_DATA.heads_up;
    const ideas = [{ ...s.data.ideas[0], overBudget: true }, ...s.data.ideas.slice(1)];
    const mail = TEMPLATES.heads_up({ ...s.data, ideas }, links);
    expect(mail.text).toContain("(Over budget · Arrives by Mar 5 · Amazon)");
  });

  it("a missing buy link is refused rather than sent as href=undefined", () => {
    const s = SAMPLE_DATA.heads_up;
    expect(() => TEMPLATES.heads_up(s.data, { choose: links.choose, buy0: BUY(0) })).toThrow(/buy1/);
  });

  it("reminder and final notice carry the same links", () => {
    const r = SAMPLE_DATA.reminder;
    const f = SAMPLE_DATA.final_notice;
    for (const mail of [TEMPLATES.reminder(r.data, links), TEMPLATES.final_notice(f.data, links)]) {
      expect(mail.html.match(/Buy this/g)).toHaveLength(3);
      expect(mail.html).toContain(`href="${BUY(2)}"`);
      expect(mail.html).toMatch(/background:#0f766e[^>]*>Pick several or none of these</);
      expect(mail.html).toContain('href="https://example.com/rounds/r1"');
      expect(mail.html.match(/background:#0f766e/g)).toHaveLength(1);
    }
  });

  it("the auto-buy heads-up keeps its button and has no Buy this links", () => {
    const s = SAMPLE_DATA.heads_up;
    const mail = TEMPLATES.heads_up({ ...s.data, mode: "auto_buy", autoBuyIdea: "the mug", autoBuyDate: "March 5" }, links);
    expect(mail.html).not.toContain("Buy this");
    expect(mail.html).toContain("Review or change");
  });
});

describe("failure emails link each gift to its own fix page (ALL-29 AC-16)", () => {
  it("failed_several links each gift to its own fix page", () => {
    const s = SAMPLE_DATA.failed_several;
    const [a, b] = s.data.failed;
    const mail = TEMPLATES.failed_several(s.data, s.links);
    expect(mail.text).toContain(`${a.action}: ${a.url}`);
    expect(mail.text).toContain(`${b.action}: ${b.url}`);
    expect(a.url).not.toBe(b.url);
    expect(mail.html).toContain(`href="${a.url}"`);
    expect(mail.html).toContain(`href="${b.url}"`);
    expect(mail.html.match(/background:#0f766e/g)).toHaveLength(1);
  });

  it("a single price_up email opens that order's fix page", () => {
    const s = SAMPLE_DATA.price_up;
    const url = "https://example.com/rounds/r1/fix/o1";
    const mail = TEMPLATES.price_up(s.data, { open: url });
    expect(mail.html).toContain(`href="${url}"`);
    expect(mail.text).toContain(`Review the gift: ${url}`);
  });
});

describe("store_cancelled_late (the store cancelled, too late to ship another)", () => {
  const s = () => SAMPLE_DATA.store_cancelled_late;

  it("one gift: sorry, the store and the refund, too late, what you can do, what happens next", () => {
    const mail = TEMPLATES.store_cancelled_late(s().data, s().links);
    expect(mail.subject).toBe("Sorry, the store cancelled Mom's gift");
    expect(mail.text).toContain("We're sorry. Walmart cancelled the Le Creuset mug set for Mom's birthday on Saturday, March 14.");
    expect(mail.text).toContain("The $42.18 is back in your Zinc wallet.");
    expect(mail.text).toContain("It's too late for us to ship another gift in time.");
    expect(mail.text).toContain("Get something locally for the day");
    expect(mail.text).toContain("Or send something a little late");
    expect(mail.text).toContain("What happens next: nothing more is bought for this birthday, and we'll start on Mom's next occasion as usual.");
    expect(mail.text).not.toMatch(/couldn't buy|No gift was chosen/);
  });

  it("drops the store or the amount when it isn't known, rather than inventing it", () => {
    const mail = TEMPLATES.store_cancelled_late({ ...s().data, gifts: [{ title: "Mug" }] }, s().links);
    expect(mail.text).toContain("We're sorry. The store cancelled the Mug for Mom's birthday");
    expect(mail.text).toContain("The money is back in your Zinc wallet.");
  });

  it("several gifts: one email with a row each", () => {
    const gifts = [
      { title: "Mug", store: "Walmart", amountText: "$42.18" },
      { title: "Apron" },
    ];
    const mail = TEMPLATES.store_cancelled_late({ ...s().data, gifts }, s().links);
    expect(mail.subject).toBe("Sorry, the store cancelled 2 of Mom's gifts");
    expect(mail.text).toContain("- Mug (Walmart cancelled it. The $42.18 is back in your Zinc wallet.)");
    expect(mail.text).toContain("- Apron (The store cancelled it. The money is back in your Zinc wallet.)");
    expect(mail.text).toContain("It's too late for us to ship other gifts in time.");
  });
});

describe("failed_several with store-cancelled gifts (bought, then refunded)", () => {
  const s = () => SAMPLE_DATA.failed_several;
  const row = (title: string, refunded = false) => ({ title, detail: "d", action: "a", url: "https://example.com/f", ...(refunded ? { refunded: true } : {}) });

  it("all cancelled by the store: says so and the money is back, never 'not charged' or 'couldn't be bought'", () => {
    const mail = TEMPLATES.failed_several({ ...s().data, tried: 2, failed: [row("Mug", true), row("Apron", true)] }, s().links);
    expect(mail.subject).toBe("Sorry, the store cancelled 2 of Mom's birthday gifts");
    expect(mail.text).toContain("We're sorry. The store cancelled 2 of the gifts we ordered for Mom's birthday on Saturday, March 14. The money for them is back in your Zinc wallet.");
    expect(mail.text).not.toMatch(/haven't been charged|couldn't be bought/);
  });

  it("mixed: the not-charged sentence covers only the others", () => {
    const mail = TEMPLATES.failed_several({ ...s().data, tried: 3, failed: [row("Mug", true), row("Apron")] }, s().links);
    expect(mail.subject).toBe("Sorry, 2 of Mom's birthday gifts need another choice");
    expect(mail.text).toContain(
      "We're sorry. Of the gifts we tried for Mom's birthday on Saturday, March 14, the store cancelled 1 and 1 didn't go through. The money for the cancelled gift is back in your Zinc wallet, and you haven't been charged for the other.",
    );
    expect(mail.text).not.toMatch(/couldn't be bought/);
  });
});

describe("late again, after good news", () => {
  it("gift_late says again in the subject and the first line", () => {
    const s = SAMPLE_DATA.gift_late;
    const mail = TEMPLATES.gift_late({ ...s.data, again: true }, s.links);
    expect(mail.subject).toBe("Mom's gift may be late again");
    expect(mail.text).toContain("We're sorry, this changed again.");
    expect(TEMPLATES.gift_late(s.data, s.links).text).not.toContain("again");
  });

  it("the summary's row says again", () => {
    const item = { kind: "late" as const, personName: "Mom", occasion: "birthday", dateText: "Saturday, March 14", title: "Mug", expectedText: "Mon, Mar 16", daysLate: 2 };
    expect(TEMPLATES.tracking_news({ items: [{ ...item, again: true }, { ...item, title: "Vase" }] }, {}).text).toContain("Mug may arrive late again");
    expect(TEMPLATES.tracking_news({ items: [item, { ...item, title: "Vase" }] }, {}).text).not.toContain("again");
  });
});

describe("gift_late (one gift may arrive after the occasion)", () => {
  const s = () => SAMPLE_DATA.gift_late;

  it("says sorry, the dates, that it can't be cancelled, the options and the one button", () => {
    const mail = TEMPLATES.gift_late(s().data, s().links);
    expect(mail.subject).toBe("Mom's gift may arrive after their birthday");
    expect(mail.html).toContain("gift may arrive after their birthday");
    expect(mail.text).toContain(
      "We're sorry. The Cozy throw blanket for Mom's birthday on Saturday, March 14 is now expected Monday, March 16, two days late.",
    );
    expect(mail.text).toContain("It's already on its way, so it can't be cancelled.");
    expect(mail.text).toContain("- Keep it (Nothing to do. It arrives Monday, March 16.)");
    expect(mail.text).toContain("- Get something locally for the day (Then return the Cozy throw blanket once it arrives, if you like.)");
    expect(mail.text).toContain("It already arrived: https://example.com/rounds/r1");
    expect(mail.text).toContain("What happens next: we keep watching it. If it's back on time, we'll let you know.");
  });

  it("one day late, and a holiday keeps its name", () => {
    const mail = TEMPLATES.gift_late({ ...s().data, occasion: "Christmas", daysLate: 1 }, s().links);
    expect(mail.subject).toBe("Mom's gift may arrive after Christmas");
    expect(mail.text).toContain("one day late.");
  });

  it("no button when the gift hasn't shipped", () => {
    const mail = TEMPLATES.gift_late(s().data, {});
    expect(mail.text).not.toContain("It already arrived");
    expect(mail.html.match(/background:#0f766e/g) ?? []).toHaveLength(0);
  });
});

describe("gift_on_time (a late gift is back on time)", () => {
  it("good news, the new date, nothing to do, a link to the gift", () => {
    const s = SAMPLE_DATA.gift_on_time;
    const mail = TEMPLATES.gift_on_time(s.data, s.links);
    expect(mail.subject).toBe("Good news: Mom's gift is back on time");
    expect(mail.text).toContain("The Cozy throw blanket is now expected Friday, March 13, in time for Mom's birthday on Saturday, March 14.");
    expect(mail.text).toContain("There's nothing you need to do.");
    expect(mail.text).toContain(`See Mom's gift: ${s.links.open}`);
  });
});

describe("delivered (every gift of the occasion arrived)", () => {
  it("names each gift with its date, links to the round, and says what happens next without a gender", () => {
    const s = SAMPLE_DATA.delivered;
    const mail = TEMPLATES.delivered(s.data, s.links);
    expect(mail.subject).toBe("Mom's gift was delivered");
    expect(mail.text).toContain("Everything you chose for Mom's birthday on Saturday, March 14 has arrived.");
    expect(mail.text).toContain("Cozy throw blanket");
    expect(mail.text).toContain("Delivered Friday, March 13");
    expect(mail.text).toContain("Delivered Saturday, March 14");
    expect(mail.text).toContain(`See Mom's gift: ${s.links.open}`);
    expect(mail.text).toContain("What happens next: after the occasion we'll ask how they liked it.");
    expect(mail.text).not.toMatch(/(she|her)/);
  });
});

describe("reaction_prompt (how the gifts went over)", () => {
  const s = SAMPLE_DATA.reaction_prompt;
  it("lists each gift with its own four links, in html and text", () => {
    const mail = TEMPLATES.reaction_prompt(s.data, s.links);
    expect(mail.subject).toBe("How did Mom like the gifts?");
    expect(mail.html.match(/<a[\s>]/g)).toHaveLength(8);
    for (const label of ["Loved it", "Liked it", "Meh", "Returned it"]) expect(mail.html.split(`>${label}</a>`)).toHaveLength(3);
    const at = (u: string) => mail.text.indexOf(u);
    expect(at(`Returned it: ${s.links.returned0}`)).toBeGreaterThan(at("Cozy throw blanket"));
    expect(at(`Returned it: ${s.links.returned0}`)).toBeLessThan(at("Reading lamp"));
    expect(at(`Loved it: ${s.links.loved1}`)).toBeGreaterThan(at("Reading lamp"));
    expect(mail.text).toContain("You can skip any gift. Nothing is saved until you tap Save.");
  });
  it("says whose occasion each gift was for only when there are several, and what answering is for", () => {
    const [mom] = s.data.rounds;
    const dad = { personName: "Dad", occasion: "anniversary", dateText: "Monday, March 16", gifts: [{ title: "Tea" }] };
    const one = TEMPLATES.reaction_prompt(s.data, s.links);
    expect(one.text).toContain("- Cozy throw blanket\n");
    expect(one.text).not.toMatch(/better/);
    expect(one.text).toContain("It helps us choose next time.");
    const links = { ...s.links, loved2: "https://x.test/l", liked2: "https://x.test/k", meh2: "https://x.test/m", returned2: "https://x.test/r" };
    const several = TEMPLATES.reaction_prompt({ rounds: [mom, dad] }, links);
    expect(several.subject).toBe("How did your gifts go over?");
    expect(several.html).toContain(">How did your gifts go over?</h1>");
    expect(several.text).toContain("- Reading lamp (Mom's birthday, Saturday, March 14)");
    expect(several.text).toContain("- Tea (Dad's anniversary, Monday, March 16)\n  Loved it: https://x.test/l");
  });
  it("one gift: says the gift, escapes its title, and needs every link", () => {
    const data = { rounds: [{ ...s.data.rounds[0], gifts: [{ title: '<b>&"' }] }] };
    const mail = TEMPLATES.reaction_prompt(data, s.links);
    expect(mail.subject).toBe("How did Mom like the gift?");
    expect(mail.html).toContain("&lt;b&gt;&amp;&quot;");
    expect(mail.html).not.toContain("<b>");
    expect(() => TEMPLATES.reaction_prompt(data, {})).toThrow("No link for answer loved0");
  });
});

describe("tracking_news (one daily summary of a buyer's gift news)", () => {
  const s = () => SAMPLE_DATA.tracking_news;

  it("bad news first with an apology, a row each, the arrived link on shipped late gifts, what you can do", () => {
    const mail = TEMPLATES.tracking_news(s().data, s().links);
    expect(mail.subject).toBe("Updates on 3 of your gifts");
    expect(mail.text).toContain("We're sorry, two of your gifts have bad news. One has good news.");
    const late = mail.text.indexOf("- Cozy throw blanket may arrive late");
    const cancelled = mail.text.indexOf("- The store cancelled the Reading lamp");
    const onTime = mail.text.indexOf("- Good news: the Tea sampler is back on time");
    expect(late).toBeGreaterThan(-1);
    expect(cancelled).toBeGreaterThan(late);
    expect(onTime).toBeGreaterThan(cancelled);
    expect(mail.text).toContain(
      "(For Mom's birthday on Saturday, March 14. Now expected Monday, March 16, two days late. It's on its way and can't be cancelled.)",
    );
    expect(mail.text).toContain("It already arrived: https://example.com/rounds/r1");
    expect(mail.text).toContain("(For Mom's birthday on Saturday, March 14. The $34.50 is back in your Zinc wallet. It's too late to ship another in time.)");
    expect(mail.text).toContain("(For Dad's birthday on Friday, March 20. Now expected Wednesday, March 18.)");
    expect(mail.text).toContain(
      "What you can do for a late or cancelled gift: keep a late one (nothing to do), or get something locally for the day and return the late one once it arrives. Nothing more is bought for these occasions.",
    );
    expect(mail.html.match(/background:#0f766e/g) ?? []).toHaveLength(0);
  });

  it("only good news: no apology and nothing to do", () => {
    const items = s().data.items.filter((i) => i.kind === "on_time");
    const mail = TEMPLATES.tracking_news({ items: [...items, { ...items[0], title: "Mug" }] }, {});
    expect(mail.subject).toBe("Updates on 2 of your gifts");
    expect(mail.text).toContain("Good news: two of your gifts are back on time. There's nothing you need to do.");
    expect(mail.text).not.toMatch(/sorry|What you can do/);
  });

  it("a placed late gift has no arrived link, and money not known is never guessed", () => {
    const items = s().data.items.map((i) => (i.kind === "late" ? { ...i, url: undefined } : i.kind === "cancelled" ? { ...i, amountText: undefined } : i));
    const mail = TEMPLATES.tracking_news({ items }, {});
    expect(mail.text).not.toContain("It already arrived");
    expect(mail.text).toContain("The money is back in your Zinc wallet.");
  });
});
