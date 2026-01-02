# Sprites

This folder contains sprite image files for TinyForge.

## File Naming Convention

Sprites use the same ID-based naming pattern as audio files:
- Format: `{ID}-description.png`
- Examples: `0-player.png`, `1_enemy.png`, `2 coin.png`

The numeric ID (0-255) at the start is extracted and used to reference the sprite in code.

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
