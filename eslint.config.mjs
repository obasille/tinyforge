// @ts-check

import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ...eslint.configs.recommended,
    ignores: ["dist/**"],
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["src/**/*.ts"],
    ignores: ["src/assembly/sdk/**"],
  })),
  {
    files: ["scripts/*.js"],
    languageOptions: {
      globals: {
        process: true,
        console: true,
        require: true,
        module: true,
        __dirname: true,
      },
    },
  },
  {
    files: ["sw.js"],
    languageOptions: {
      globals: {
        self: true,
        caches: true,
        fetch: true,
      },
    },
  },
]);
