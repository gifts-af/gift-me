import { describe, expect, it } from "vitest";
import { SAMPLE_DATA, TEMPLATES, type NotificationKind } from "../notify/templates";

const kinds = Object.keys(SAMPLE_DATA) as NotificationKind[];

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
  it("has the logo, one button, 600px, inline styles only", () => {
    expect(mail.html).toContain("https://giftsaf.com/email-logo.png");
    // One teal button; anything else is a plain link (a hold's "Cancel this gift").
    expect(mail.html.match(/background:#0f766e/g)).toHaveLength(1);
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
    expect(mail.html.match(/<a[\s>]/g)).toHaveLength(2);
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
    expect(mail.text).toContain(`Review the new price for the Le Creuset mug set: ${s.links.open}`);
    expect(mail.text).toContain(`Choose another gift instead of the Linen apron: ${s.links.open}`);
    expect(mail.text).toContain("Choose by Thursday, March 5 so it arrives in time.");
    expect(mail.html.match(/background:#0f766e/g)).toHaveLength(1);
  });

  it("says neither when both of two failed, and leaves out the good news when nothing is on its way", () => {
    const mail = TEMPLATES.failed_several({ ...s.data, tried: 2, onItsWay: undefined }, s.links);
    expect(mail.text).toContain("and neither of them went through. You haven't been charged for either.");
    expect(mail.text).not.toContain("good news");
  });

  it("says none, and them, when three of three failed", () => {
    const three = [...s.data.failed, { title: "Vase", detail: "The store ran out. Choose another gift." }];
    const mail = TEMPLATES.failed_several({ ...s.data, tried: 3, failed: three, onItsWay: undefined }, s.links);
    expect(mail.text).toContain("and none of them went through. You haven't been charged for them.");
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
      "We're sorry. The price of the Le Creuset mug set for Mom's birthday on Saturday, March 14 went up more than you allowed for, so we didn't buy it and you haven't been charged.",
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

describe("ordered (PRD A-8, owner)", () => {
  it("says it's ordered and where it's going, city only, with one button", () => {
    const mail = render("ordered");
    expect(mail.subject).toBe("Mom's gift is ordered");
    expect(mail.text).toContain(
      "We ordered the Le Creuset mug set for Mom's birthday on Saturday, March 14. It's on its way to Dayton. We'll let you know when it ships.",
    );
    expect(mail.text).toContain("Open Mom's page:");
    expect(mail.html.match(/<a[\s>]/g)).toHaveLength(1);
  });

  it("leaves the place out when the city isn't known", () => {
    const s = SAMPLE_DATA.ordered;
    expect(TEMPLATES.ordered({ ...s.data, cityText: undefined }, s.links).text).toContain("It's on its way. We'll let you know");
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
