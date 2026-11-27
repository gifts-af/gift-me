import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// connect_enabled is one switch for the whole app, and card-payments.spec.ts runs on three browsers
// at once: its @layout test on the Android phone and desktop runs while the iPhone's "switched off"
// test turns it off. So each card test holds a "needs it on" pass, and turning it off waits until
// no other pass is held (a readers-writer lock in files, shared by every worker on this machine).
// global-setup.ts clears it at the start of a run, so a killed run can't leave it held.
const DIR = path.join(tmpdir(), "gifts-af-e2e-connect");
const OFF = path.join(DIR, "off");
const PASSES = path.join(DIR, "on");
const WAIT_MS = 240_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function clearConnectSwitch(): void {
  rmSync(DIR, { recursive: true, force: true });
}

/** Holds "needs paying by card on" until the returned release is called. Waits while it's being switched off. */
export async function holdConnectOn(): Promise<() => void> {
  mkdirSync(PASSES, { recursive: true });
  const pass = path.join(PASSES, randomUUID());
  const until = Date.now() + WAIT_MS;
  for (;;) {
    // Take the pass first, then look: a switch-off that started meanwhile waits for it.
    writeFileSync(pass, "");
    if (!existsSync(OFF)) return () => rmSync(pass, { force: true });
    rmSync(pass, { force: true });
    if (Date.now() > until) throw new Error("connect_enabled stayed switched off for 4 minutes");
    await sleep(200);
  }
}

/** Runs `fn` with paying by card switched off, once no other test holds a pass; the caller holds none. */
export async function whileConnectOff(setOn: (on: boolean) => Promise<void>, fn: () => Promise<void>): Promise<void> {
  mkdirSync(PASSES, { recursive: true });
  writeFileSync(OFF, "");
  try {
    const until = Date.now() + WAIT_MS;
    while (readdirSync(PASSES).length > 0) {
      if (Date.now() > until) throw new Error("Other card tests kept connect_enabled needed for 4 minutes");
      await sleep(200);
    }
    await setOn(false);
    try {
      await fn();
    } finally {
      await setOn(true);
    }
  } finally {
    rmSync(OFF, { force: true });
  }
}
