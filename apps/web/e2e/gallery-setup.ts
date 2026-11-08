import { rmSync } from "node:fs";
import path from "node:path";
import globalSetup from "./global-setup";

// Empties gallery/ so a screen that was removed doesn't linger, then runs the
// browser tests' own setup (test accounts, fake Zinc) (ALL-000).
export default async function gallerySetup() {
  rmSync(path.resolve(__dirname, "../gallery"), { recursive: true, force: true });
  return globalSetup();
}
