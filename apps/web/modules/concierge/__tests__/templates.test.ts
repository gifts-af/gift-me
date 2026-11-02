import { describe, expect, it } from "vitest";
import { SAMPLE_DATA, TEMPLATES, type NotificationKind } from "../notify/templates";

const kinds = Object.keys(SAMPLE_DATA) as NotificationKind[];

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
  it("has one button, 600px, inline styles only", () => {
    expect(mail.html.match(/<a[\s>]/g)).toHaveLength(1);
    expect(mail.html).toContain("max-width:600px");
    expect(mail.html).not.toContain("<style");
    expect(mail.html).not.toContain("class=");
  });
  it("lays out at the phone's width, not a 980px desktop width (ALL-60)", () => {
    expect(mail.html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(mail.html).toContain('<meta charset="utf-8">');
  });
  it("contains every link in html and text", () => {
    for (const u of urls) {
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
