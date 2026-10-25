import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import boundaries from "eslint-plugin-boundaries";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  { ignores: [".next/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Product boundaries (T19, design §2.2): each product in modules/<name>
  // is only reachable through its index.ts from outside that product.
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "module", pattern: "modules/*", capture: ["name"] },
        // Shared code and routes: declared so their imports are checked too.
        { type: "app", pattern: "app/**", mode: "full" },
        { type: "shared", pattern: ["components/**", "lib/**"], mode: "full" },
      ],
      "import/resolver": { typescript: { project: "./tsconfig.json" } },
    },
    rules: {
      "boundaries/entry-point": [
        2,
        {
          default: "allow",
          rules: [
            { target: { element: { type: "module" } }, disallow: "**" },
            { target: { element: { type: "module" } }, allow: "index.ts" },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
