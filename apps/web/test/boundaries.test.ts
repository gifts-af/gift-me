// @vitest-environment node
// Proves the product boundary rule (T19) keeps working: outside code may
// import a product only through its index.ts.
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: path.resolve(__dirname, "..") });

async function boundaryErrors(file: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: path.resolve(__dirname, "..", file) });
  return result.messages.filter((m) => m.ruleId === "boundaries/entry-point");
}

describe("product boundaries", () => {
  it("allows importing a product's public API", async () => {
    const errors = await boundaryErrors(
      "modules/concierge/probe.ts",
      'import { getMyList } from "@/modules/lists";\nexport const x = getMyList;\n',
    );
    expect(errors).toEqual([]);
  });

  it("blocks another product from reaching into its internals", async () => {
    const errors = await boundaryErrors(
      "modules/concierge/probe.ts",
      'import { formatCents } from "@/modules/lists/lib/format.js";\nexport const x = formatCents;\n',
    );
    expect(errors).toHaveLength(1);
  });

  it("blocks routes from reaching into a product's internals", async () => {
    const errors = await boundaryErrors(
      "app/probe.ts",
      'import { formatCents } from "@/modules/lists/lib/format.js";\nexport const x = formatCents;\n',
    );
    expect(errors).toHaveLength(1);
  });

  it("lets a product use its own internals", async () => {
    const errors = await boundaryErrors(
      "modules/lists/probe.ts",
      'import { formatCents } from "@/modules/lists/lib/format.js";\nexport const x = formatCents;\n',
    );
    expect(errors).toEqual([]);
  });
});
