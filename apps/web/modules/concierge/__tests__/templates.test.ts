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
  it("says nothing was bought and has one button", () => {
    const s = SAMPLE_DATA.skipped;
    const mail = TEMPLATES.skipped(s.data, s.links);
    expect(mail.subject).toBe("No gift for Mom's birthday this time");
    expect(mail.text).toContain("No gift was chosen for Mom's birthday (Saturday, March 14), so nothing was bought.");
    expect(mail.text).toContain("You can still buy something yourself. We'll be back for the next occasion.");
    expect(mail.html).toContain("Open GiftsAF");
    expect(mail.html.match(/<a[\s>]/g)).toHaveLength(1);
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
const ALPHA = "Alpha:";

describe.each(HOLDS)("hold email %s", (kind) => {
  const mail = render(kind);
  it("carries the alpha line and a plain cancel link under the button", () => {
    const cancel = (SAMPLE_DATA[kind].links as { cancel: string }).cancel;
    expect(mail.text).toContain(ALPHA);
    expect(mail.text).toContain(`Changed your mind? Cancel this gift: ${cancel}`);
    expect(mail.html.match(/<a[\s>]/g)).toHaveLength(2);
  });
});

describe.each(["hold_unconfirmed", "price_up", "out_of_stock", "too_late", "missed_on_us"] as const)("%s", (kind) => {
  it("has no cancel link or alpha line", () => {
    const mail = render(kind);
    expect(mail.text).not.toContain("Cancel this gift");
    expect(mail.text).not.toContain(ALPHA);
  });
});

describe("hold_funds", () => {
  const s = SAMPLE_DATA.hold_funds;
  it("says what Zinc needs, what they have and the shortfall, and links the wallet", () => {
    const mail = TEMPLATES.hold_funds(s.data, s.links);
    expect(mail.subject).toBe("Mom's gift is waiting on your Zinc balance");
    expect(mail.text).toContain("Top up to send Mom's gift");
    expect(mail.text).toContain(
      "You chose the Le Creuset mug set for Mom's birthday on Saturday, March 14. Zinc needs $46.20 in your balance to buy it (the gift with room for a small price change, plus Zinc's $1 fee). You have $12, so you're $34.20 short.",
    );
    expect(mail.text).toContain("Add funds in Zinc and we'll buy it as soon as we see them, usually within a day.");
    expect(mail.text).toContain(`Top up your Zinc balance: ${s.data.walletUrl}`);
    expect(mail.text).toContain("Alpha: topping up means we'll buy this gift, its price plus Zinc's $1 fee.");
    expect(mail.text).toContain("To avoid this next time, turn on auto top-up in Zinc.");
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
    expect(mail.text).toContain("to buy them");
  });
});

describe("the other gift emails match the mock-ups", () => {
  it("hold_setup", () => {
    const mail = render("hold_setup");
    expect(mail.subject).toBe("Finish setting up payment to send Mom's gift");
    expect(mail.text).toContain("Finish setting up payment");
    expect(mail.text).toContain("Connect Zinc and add your phone in Settings.");
    expect(mail.text).toContain("Finish setup:");
  });

  it("hold_address", () => {
    const mail = render("hold_address");
    expect(mail.subject).toBe("Mom's gift needs an address");
    expect(mail.text).toContain(
      "You chose the Le Creuset mug set for Mom's birthday on Saturday, March 14, but we don't have an address we can ship to.",
    );
    expect(mail.text).toContain("Fix the address:");
  });

  it("price_up", () => {
    const mail = render("price_up");
    expect(mail.subject).toBe("The price of Mom's gift went up");
    expect(mail.text).toContain("Mom's gift went up in price");
    expect(mail.text).toContain("Review the gift:");
    expect(mail.text).toContain("Nothing is bought until you choose.");
  });

  it("out_of_stock", () => {
    const mail = render("out_of_stock");
    expect(mail.text).toContain("The store ran out of the Le Creuset mug set, so we didn't buy it and nothing was charged.");
    expect(mail.text).toContain("Choose another gift:");
  });

  it("too_late", () => {
    const mail = render("too_late");
    expect(mail.subject).toBe("Mom's gift can't arrive in time");
    expect(mail.text).toContain("Too late for Mom's gift");
    expect(mail.text).toContain("See faster gifts:");
  });

  it("hold_unconfirmed", () => {
    const mail = render("hold_unconfirmed");
    expect(mail.subject).toBe("We're confirming Mom's gift with the store");
    expect(mail.text).toContain("You won't be charged twice, and we'll email you as soon as we know.");
    expect(mail.text).toContain("Open Mom's page:");
  });

  it("hold_trouble", () => {
    const mail = render("hold_trouble");
    expect(mail.subject).toBe("We're having trouble ordering Mom's gift");
    expect(mail.text).toContain("Still trying to order Mom's gift");
  });

  it("missed_on_us: on us, nothing bought or charged (owner)", () => {
    const mail = render("missed_on_us");
    expect(mail.subject).toBe("We couldn't send Mom's gift in time");
    expect(mail.text).toContain("We couldn't send Mom's gift in time");
    expect(mail.text).toContain(
      "A problem on our side stopped us placing the order before it was too late to arrive. That's on us. Nothing was bought and nothing was charged.",
    );
    expect(mail.text).toContain("Open Mom's page:");
  });

  it("skipped says a chosen gift wasn't bought, when one was held", () => {
    const s = SAMPLE_DATA.skipped;
    const mail = TEMPLATES.skipped({ ...s.data, held: true }, s.links);
    expect(mail.text).not.toContain("No gift was chosen");
    expect(mail.text).toContain(
      "The gift you chose for Mom's birthday (Saturday, March 14) couldn't be bought in time, so nothing was bought or charged.",
    );
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
