# TinyForge

Game-writing guidance (SDK patterns, memory rules) is in `AGENTS.md`. This file
covers the repo layout and the new editor.

## Layout

pnpm workspace. Two hosts share one engine:

- `packages/engine`: AssemblyScript SDK, the games (one folder per game,
  `assembly/games/<name>/main.ts`), `memory-map.ts`, and the tooling:
  `compiler.ts` (asc JS API using `assembly/games/asconfig.json`, no Node or
  DOM APIs: the editor runs it in a Worker), `compile-game.ts` (the same from
  disk, for Node: CLI builds and tests), `project-layout.ts` (project paths),
  `game-meta.ts`, `asset-scan.ts`, `cartridge-meta.ts`.
- `packages/runtime`: host runtime in plain TS with no DOM (cartridge imports,
  memory-mapped input, sprite table, fixed-step clock). Runs in a Worker or Node.
- `packages/editor-core`: editor logic in plain TS: store, commands, the
  Workspace (`workspace.ts`, `http-workspace.ts`, `project-files.ts`), the
  compile Worker and its bridge (`compile-worker.ts`, `compiler-host.ts`), the
  game Worker (`worker-core.ts`, `game-worker.ts`) and its bridge
  (`game-host.ts`), the code editor and live asset scan, the asset library and import
  (`asset-library.ts`, `asset-import.ts`), the sprite editor and sound player
  (`sprite-editor.ts`, `sprite-canvas.ts`, `sound-editor.ts`, `sound-view.ts`,
  with plain-TS `png.ts` and `wav.ts`), viewport, memory view. The AI tools
  are apart in `src/ai/` (`@tinyforge/editor-core/ai`, loaded only by the AI
  panel): provider interface, the Claude adapter and an OpenAI-compatible one
  (`openai.ts`, no SDK), the code agent and its tools,
  and the asset generators (`synth.ts` for sounds, `pixels.ts` for sprites).
- `apps/editor`: React + Dockview UI, Vite, the `tinyforge` Vite plugin (serves
  and watches project files; it does not compile), and `vite/ai-proxy.ts` (dev
  server only: adds the API key from `.env` to the AI panel's requests, and
  forwards them to Claude or to the OpenAI-compatible server set in `.env`).
- `apps/classic`: the original host, deployed to the site root. Keep it working,
  with minimal changes and no code shared with the editor packages. What it
  does not do is listed in `apps/classic/README.md`.

## Engine contract (do not change without a decision)

Cartridges export `init`, `update`, `draw`; import `env.memory` and the `env`
functions in `packages/runtime/src/machine.ts`. Memory is sized per game: each
cartridge has a `tinyforge.meta` section (written by `compileGame`) with its
memory layout version, `ram` (the game's `RAM_SIZE`), `memory` (the module's
minimum, where static data ends) and the asset IDs it uses. The host adds the
sprite table past `memory` and points `SPRITE_TABLE_PTR_ADDR` at it. Host code
reads addresses from `LAYOUTS[version]` (`packages/runtime/src/layout.ts`),
never from `memory-map.ts` directly; layout entries are never removed, and a
cartridge without `tinyforge.meta` is refused. All game state lives in linear
memory, so the host implements pause, step, snapshot/restore and hot reload by
itself. Build settings come from `asconfig.json`, plus the `memoryBase`
(`RAM_START + RAM_SIZE`) that `compileGame` passes for each game.

## Editor architecture rules

1. One project state, plain JSON-serializable data, outside components.
2. Every project edit is a command (`apply`/`revert`) run through `CommandStack`.
3. `editor-core` and `runtime` never import React.
4. React panels mount a container and hand it to plain-TS code; per-frame work
   (game frames, memory view) never goes through React.
5. The game runs in a Worker; the editor only talks to it through `GameHost`.
   Memory is read through watches (pushed every frame) or snapshots.
6. Tweakpane and other DOM widgets subscribe to stores directly.
7. Files are reached only through the Workspace (`ProjectFiles` in the editor),
   by project path (`games/...`, `engine/...`, `assets/...`). Nothing checks
   which deployment it runs in; a new one is a new Workspace adapter. A file
   edit is a `FileCommand` on the same `CommandStack`. Every file change, the
   editor's own included, arrives through `ProjectFiles.onChange`.

## How to verify

```
pnpm install
pnpm typecheck
pnpm lint          # Biome for the new packages, ESLint for the classic host
pnpm test          # Vitest: runtime + editor-core (boots every game)
pnpm test:e2e      # Playwright smoke tests (starts its own Vite server)
pnpm build:classic # classic host still builds
```

To check the UI by hand: `pnpm dev`, open the page, and use `window.__tf`
(editor, project, session, snapshot) instead of clicking where you can. Take a
screenshot of the result.
