import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "eval/**", "contracts/**", "**/*.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "error"
    }
  },
  {
    // CLI entrypoints and report generators may write to stdout directly.
    files: ["**/cli/**", "**/*.cli.ts", "data/src/**"],
    rules: { "no-console": "off" }
  }
);
