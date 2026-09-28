import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import ts from "typescript-eslint";

export default ts.config(
  { ignores: ["dist/", "public/replays/"] },
  js.configs.recommended,
  ...ts.configs.strict,
  ...svelte.configs.recommended,
  { languageOptions: { globals: globals.browser } },
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
);
