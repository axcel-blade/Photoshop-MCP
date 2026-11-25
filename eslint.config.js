import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["temp/**", "dist/**", "node_modules/**", "site/**", "photoshop-scripts/**", "release/**", "logs/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "no-console": ["error", { allow: ["error"] }],
    },
  },
  {
    files: ["scripts/**/*.{js,mjs,ts}", "tests/**"],
    languageOptions: { globals: { console: "readonly", process: "readonly", fetch: "readonly", setTimeout: "readonly", URL: "readonly" } },
    rules: { "no-console": "off", "@typescript-eslint/no-explicit-any": "off" },
  },
);
