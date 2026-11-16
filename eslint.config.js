import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "public/fonts/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-explicit-any": "off", // check scripts parse loose SSE JSON
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Browser code: plain scripts, no build step. Unsafe DOM APIs are banned outright.
    files: ["public/**/*.js"],
    languageOptions: { sourceType: "script", globals: globals.browser },
    rules: {
      "no-restricted-properties": [
        "error",
        { property: "innerHTML", message: "Model output is untrusted: build DOM with textContent." },
        { property: "outerHTML", message: "Use DOM APIs, not HTML strings." },
        { property: "insertAdjacentHTML", message: "Use DOM APIs, not HTML strings." },
      ],
      "no-eval": "error",
      "no-implied-eval": "error",
    },
  },
  prettier,
);
