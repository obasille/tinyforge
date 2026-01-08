# Sprites

This folder contains sprite image files for TinyForge.

## File Naming Convention

### Single Sprites

- Format: `{ID}-description.png`
- Examples: `0-player.png`, `1_enemy.png`, `2 coin.png`

The numeric ID (0-255) at the start is extracted and used to reference the sprite in code.

### Sprite Sheets

Sprite sheets allow you to pack multiple sprites into a single image file, which are automatically split into individual sprites.

- Format: `{ID}~{COLS}x{ROWS}-description.png`
- Examples: 
  - `10~4x3-tiles.png` - Sprite sheet starting at ID 10, with 4 columns and 3 rows (12 sprites total)
  - `50~8x2-characters.png` - Sprite sheet starting at ID 50, with 8 columns and 2 rows (16 sprites total)
  - `10~4x3.png` - Description is optional

**How it works:**
1. The image is divided into a grid of COLS × ROWS
2. Each cell becomes a separate sprite
3. Sprites are assigned sequential IDs starting from the base ID
4. Order: left-to-right, top-to-bottom

**Example:**
```
File: 10~4x3-tiles.png (128x96 image)
Grid: 4 columns × 3 rows = 12 sprites
Sprite size: 32x32 pixels each
IDs assigned: 10, 11, 12, 13 (row 1)
              14, 15, 16, 17 (row 2)
              18, 19, 20, 21 (row 3)
```

**Notes:**
- Format uses tilde (~) to separate ID from dimensions
- Dimensions use 'x' separator: `COLS x ROWS`
- Everything after dimensions is ignored (just like single sprite names)
- Grid dimensions are calculated by dividing image size by columns/rows
- All sprites in a sheet have the same dimensions
- Maximum sprite ID is 255 (excess sprites are skipped)

## Supported Formats

- **PNG** - Recommended, supports transparency (alpha channel)
- **JPEG/JPG** - No transparency support

## Sprite Properties

- **Transparency**: Alpha channel is preserved. Pixels with alpha < 128 are treated as transparent
- **Color Format**: Images are converted to ABGR format internally
- **Size**: No enforced limit, but keep sprites reasonably sized for performance
- **Memory**: All loaded sprites are stored in WASM memory (starting at 0x0AB100)

## Usage in Games

```typescript
import { drawSprite, drawSpriteFlip } from './console';

// Draw sprite 0 at position (100, 100)
drawSprite(0, 100, 100);

// Draw sprite 1 flipped horizontally
drawSpriteFlip(1, 50, 50, true, false);
```

## Sprite Data Structure

Each sprite entry in memory contains:
- Offset +0: u16 width (pixels)
- Offset +2: u16 height (pixels)
- Offset +4: u32 dataOffset (pointer to pixel data)
- Offset +8: Next sprite metadata...

Pixel data follows all metadata entries in RGBA format (4 bytes per pixel).
