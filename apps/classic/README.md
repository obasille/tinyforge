# Classic host

The original TinyForge host, deployed at the site root. It runs the release
cartridges that `scripts/build-games.js` writes to `assets/cartridges/`.

It is kept working with as few changes as possible and shares no code with
the new editor (`apps/editor`, `packages/editor-core`, `packages/runtime`). It
only imports constants from `packages/engine/memory-map.ts`.

## What it does

- Sizes memory per game: it reads the cartridge's `tinyforge.meta` section,
  grows memory to the module's minimum plus the sprite table, writes the table
  right after the static data and stores its address at
  `SPRITE_TABLE_PTR_ADDR`.
- Refuses a cartridge without `tinyforge.meta`, or built for another memory
  layout version, with a message to rebuild it.
- Hot reloads a cartridge when its file changes on the server (it polls the
  file's `Last-Modified`), keeping memory.

## What it does not do

- It loads every sprite and sound in the asset library, not only the ones the
  game uses. Memory still fits: the sprite table is sized to what is loaded.
- It supports only memory layout version 1, from `memory-map.ts`. It has no
  table of older layouts like `packages/runtime/src/layout.ts`.
- It does not notice a changed `RAM_SIZE` on hot reload: state is kept even
  though game RAM changed size. Reload the page instead.
- It does not reload sprites or sounds when their files change.
- It does not read assets embedded in a cartridge's custom sections.
- It has no editing, asset library, live asset scan or AI tools.
- Unknown asset IDs are caught when `build-games.js` compiles the game, not
  at runtime.
