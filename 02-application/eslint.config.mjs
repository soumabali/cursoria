import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored shadcn primitives, kept for reference but not imported by
    // the app. Moved out of components/ui so the code that ships is not
    // carrying dead files; linted separately from Site code.
    "00-vendor/**",
    // Scratch probes used while reviewing; not part of the test suite.
    "_probe_*.mjs",
    "tests/_probe_*.mjs",
  ]),
  {
    files: ["00-vendor/shadcn-unused/**/*.{ts,tsx}"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
