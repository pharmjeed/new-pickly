import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

/**
 * الأساس المشترك لكل الحزم — TypeScript strict،
 * ممنوع any بلا تعليق مبرر (CLAUDE.md — أسلوب الكود).
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "no-console": ["error", { allow: ["warn", "error"] }]
    }
  },
  {
    ignores: ["dist/**", "build/**", ".next/**", "coverage/**", "generated/**"]
  }
);
