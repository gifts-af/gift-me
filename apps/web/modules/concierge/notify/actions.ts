// The things a one-time email link can do (ALL-23). Each action brings its own
// words for the confirm page and the result page, and the work it does once the
// owner presses confirm. Real actions (ALL-28 and later) add entries here.
export type ActionName = "test";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type Action = {
  confirm: { title: string; body: string; button: string };
  done: { title: string; body: string };
  run(ctx: { userId: string; roundId: string | null }): Promise<ActionResult>;
};

export const ACTIONS: Record<ActionName, Action> = {
  // The Settings test email's button: proves the whole path and does nothing else.
  test: {
    confirm: {
      title: "Try the test button",
      body: "This is how buttons in our emails work: you confirm here, then it's done.",
      button: "Try it",
    },
    done: {
      title: "Done",
      body: "It works. Buttons in our emails will look like this.",
    },
    async run() {
      return { ok: true };
    },
  },
};
