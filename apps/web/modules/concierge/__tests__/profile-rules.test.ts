import { describe, expect, it } from "vitest";
import { SENSITIVE_REFUSAL, isId, parseAnswers, parseFactEdit } from "../profile/rules";

describe("parseAnswers", () => {
  it("leaves out questions left blank, and splits the rest into facts", () => {
    const parsed = parseAnswers({ interests: "fly fishing, crime podcasts", wants: "  ", sizes: "shirt L" }, 20);
    expect(parsed).toEqual({
      ok: true,
      answers: [
        { key: "interests", prompt: "What are they into right now?", category: "interest", values: ["fly fishing", "crime podcasts"] },
        { key: "sizes", prompt: "What sizes do they wear?", category: "size", values: ["shirt L"] },
      ],
    });
  });

  it("needs at least one answer", () => {
    expect(parseAnswers({ interests: " , ", wants: "" }, 20)).toEqual({
      ok: false,
      error: "Answer at least one, or skip them.",
    });
  });

  it("ignores fields that aren't questions", () => {
    const parsed = parseAnswers({ interests: "golf", hacked: "x" }, 20);
    expect(parsed.ok && parsed.answers.map((a) => a.key)).toEqual(["interests"]);
  });

  it("refuses an answer that would make too many facts, naming the question", () => {
    expect(parseAnswers({ wants: "a, b, c" }, 2)).toEqual({
      ok: false,
      key: "wants",
      error: "That's a lot for one answer. Keep it to 2 things.",
    });
  });

  it("refuses the whole form when one answer touches a sensitive trait (C-8)", () => {
    expect(parseAnswers({ interests: "golf", avoid: "he's diabetic" }, 20)).toEqual({
      ok: false,
      key: "avoid",
      error: SENSITIVE_REFUSAL,
    });
  });
});

describe("isId", () => {
  it("accepts a uuid and nothing else", () => {
    expect(isId("44c8b69e-2232-4a2b-b970-5af24cefcbc5")).toBe(true);
    expect(isId("")).toBe(false);
    expect(isId("44c8b69e' or 1=1")).toBe(false);
  });
});

describe("parseFactEdit", () => {
  it("tidies the value and keeps the category", () => {
    expect(parseFactEdit({ category: "size", value: "  shirt   L " })).toEqual({ ok: true, category: "size", value: "shirt L" });
  });

  it("refuses an unknown category", () => {
    expect(parseFactEdit({ category: "mood", value: "x" }).ok).toBe(false);
  });

  it("refuses a blank value", () => {
    expect(parseFactEdit({ category: "size", value: "   " })).toEqual({ ok: false, error: "Type something first." });
  });

  it("refuses a sensitive value (C-8)", () => {
    expect(parseFactEdit({ category: "interest", value: "goes to church" })).toEqual({ ok: false, error: SENSITIVE_REFUSAL });
  });
});
