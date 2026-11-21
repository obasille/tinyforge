# Sprites

Image files for TinyForge sprites. They are not compiled into the cartridge:
the host (editor or classic console) loads every file in this folder at
runtime, decodes it, and writes a sprite table into the cartridge's WASM
memory before the game runs. Games refer to sprites by string ID.

## File Naming

`{id}~{COLS}x{ROWS}-{info}.png`

Only the id is required. It is everything before the first `~`, or the first
`-` when there is no `~`.

- `heart.png` gives id `heart`, a single sprite
- `crocodile_bloody.png` gives id `crocodile_bloody` (underscores are part of the id)
- `coin~8x1.png` gives id `coin`, a sheet with 8 columns and 1 row
- `dino~9x1-run.png` gives id `dino`, a 9×1 sheet; `-run` is ignored
- `flag-big.png` gives id `flag`; `-big` is ignored

Ids are at most 16 characters and must be unique across the folder.

### Sprite Sheets

A `~COLSxROWS` format splits the image into a grid of equal frames, left to
right, top to bottom. Frame size is the image size divided by the column and
row counts. The whole sheet shares one id; pick a frame by column and row.

## Supported Formats

- **PNG**: recommended, keeps the alpha channel
- **JPEG/JPG**: no transparency

## Usage in Games

`s(id, col, row)` looks the id up in the sprite table and returns a numeric
handle (or -1 when the id or frame is missing). Pass that handle to the draw
functions.

```typescript
import { drawSprite, drawSpriteScaled, s } from "../../sdk";

drawSprite(s("heart"), 100, 100);                  // single sprite
drawSprite(s("heart"), 100, 100, true);             // flipped horizontally
drawSprite(s("heart"), 100, 100, false, false, 128); // 50% opacity
drawSprite(s("coin", 3), 40, 20);                   // frame at column 3, row 0
drawSpriteScaled(s("dino", 0), 10, 10, 2, 2);       // 2× scale
```

Look up the handle once (for example in `init()`) when drawing the same sprite
every frame, since `s()` scans the table.

## Pixels and Memory

- Pixels are stored as 4 bytes each (RGBA bytes, read as ABGR `u32` in the SDK).
- Alpha is blended: alpha 0 is skipped, 255 is opaque, values in between blend.
- The host writes the table right after the game's static data and stores
  its address at `SPRITE_TABLE_PTR_ADDR` (0x04B010). It holds up to 256
  sprites, and memory grows to fit their pixels; there is no fixed data cap.
- The layout (header, 16-character id entries, 16-byte info entries, pixel
  data) is defined in `packages/engine/memory-map.ts` and written by
  `writeSpriteTable` in `packages/runtime/src/assets.ts`.
