// @ts-check

import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    // The new editor packages are linted and formatted by Biome (biome.json).
    ignores: [
      "**/dist/**",
      "apps/editor/**",
      "packages/editor-core/**",
      "packages/runtime/**",
      "packages/engine/tooling/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["apps/classic/src/**/*.ts"],
  })),
  {
    files: ["scripts/**/*.js"],
    languageOptions: {
      globals: {
        process: true,
        console: true,
        require: true,
        module: true,
        __dirname: true,
        URL: true,
        WebAssembly: true,
      },
    },
  },
  {
    files: ["apps/classic/sw.js"],
    languageOptions: {
      globals: {
        self: true,
        caches: true,
        fetch: true,
      },
    },
  },
]);
