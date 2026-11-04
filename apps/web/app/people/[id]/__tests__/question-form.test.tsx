import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GUIDED_QUESTIONS } from "@gifts-af/core";
import { QuestionForm } from "../questions/question-form";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const questions = GUIDED_QUESTIONS.slice(0, 2);

function setup() {
  const answerAction = vi.fn(async (...a: [unknown, FormData]) => {
    void a;
    return { ok: true } as { ok: true } | { ok: false; error: string; key?: string };
  });
  const skipAction = vi.fn(async (...a: [unknown, FormData]) => (void a, { ok: true } as const));
  render(<QuestionForm personId="p1" name="Dad" questions={questions} answerAction={answerAction} skipAction={skipAction} />);
  return { answerAction, skipAction };
}

describe("QuestionForm", () => {
  it("sends each answer under its question's key", async () => {
    const user = userEvent.setup();
    const { answerAction } = setup();
    await user.type(screen.getByLabelText(questions[0].prompt), "golf, chess");
    await user.click(screen.getByRole("button", { name: "Save answers" }));
    await waitFor(() => expect(answerAction).toHaveBeenCalledOnce());
    const form = answerAction.mock.calls[0][1];
    expect(form.get("personId")).toBe("p1");
    expect(form.get("interests")).toBe("golf, chess");
    expect(form.get("wants")).toBe("");
  });

  it("forgets the answers and goes to the person's page after saving", async () => {
    const user = userEvent.setup();
    const { answerAction } = setup();
    await user.type(screen.getByLabelText(questions[0].prompt), "golf");
    await user.click(screen.getByRole("button", { name: "Save answers" }));
    await waitFor(() => expect(answerAction).toHaveBeenCalledOnce());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/people/p1"));
    expect(screen.getByLabelText(questions[0].prompt)).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save answers" })).toBeEnabled();
  });

  it("keeps every answer and says why when refused (AC-8)", async () => {
    const user = userEvent.setup();
    const { answerAction } = setup();
    answerAction.mockResolvedValueOnce({ ok: false, key: "wants", error: "Try wording it another way." });
    await user.type(screen.getByLabelText(questions[0].prompt), "golf");
    await user.type(screen.getByLabelText(questions[1].prompt), "church hat");
    await user.click(screen.getByRole("button", { name: "Save answers" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try wording it another way.");
    expect(screen.getByLabelText(questions[0].prompt)).toHaveValue("golf");
    expect(screen.getByLabelText(questions[1].prompt)).toHaveValue("church hat");
    expect(screen.getByLabelText(questions[1].prompt)).toHaveAttribute("aria-invalid", "true");
  });

  it("skips one question, by its key (AC-9)", async () => {
    const user = userEvent.setup();
    const { skipAction } = setup();
    await user.click(screen.getByRole("button", { name: `Skip: ${questions[1].prompt}` }));
    await waitFor(() => expect(skipAction).toHaveBeenCalledOnce());
    expect(skipAction.mock.calls[0][1].get("key")).toBe("wants");
  });
});
