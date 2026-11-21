# TinyForge

Game-writing guidance (SDK patterns, memory rules) is in `AGENTS.md`. This file
covers the repo layout and the new editor.

## Layout

pnpm workspace. Two hosts share one engine:

- `packages/engine`: AssemblyScript SDK, the games (one folder per game,
  `assembly/games/<name>/main.ts`), `memory-map.ts`, and
  `tooling/compile-game.ts` (asc JS API using `assembly/games/asconfig.json`).
- `packages/runtime`: host runtime in plain TS with no DOM (cartridge imports,
  memory-mapped input, sprite table, fixed-step clock). Runs in a Worker or Node.
- `packages/editor-core`: editor logic in plain TS: store, commands, the game
  Worker (`worker-core.ts`, `game-worker.ts`) and its main-thread bridge
  (`game-host.ts`), viewport, memory view.
- `apps/editor`: React + Dockview UI, Vite, the `tinyforge` Vite plugin.
- `apps/classic`: the original host, deployed to the site root. Keep it working.

## Engine contract (do not change without a decision)

Cartridges export `init`, `update`, `draw`; import `env.memory` (1 MB fixed)
and the `env` functions in `packages/runtime/src/machine.ts`. All game state
lives in linear memory, so the host implements pause, step, snapshot/restore
and hot reload by itself. Build settings come from `asconfig.json` only.

## Editor architecture rules

1. One project state, plain JSON-serializable data, outside components.
2. Every project edit is a command (`apply`/`revert`) run through `CommandStack`.
3. `editor-core` and `runtime` never import React.
4. React panels mount a container and hand it to plain-TS code; per-frame work
   (game frames, memory view) never goes through React.
5. The game runs in a Worker; the editor only talks to it through `GameHost`.
   Memory is read through watches (pushed every frame) or snapshots.
6. Tweakpane and other DOM widgets subscribe to stores directly.

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
