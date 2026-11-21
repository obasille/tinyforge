# Sound Effects

Sound effect files for TinyForge. They are not compiled into the cartridge:
the host loads every file in this folder at runtime and plays it when a game
calls `playSfx(id, volume)`.

## File Naming

`{id}-{info}.ext`

The id is everything before the first `-` (or the whole name). Underscores and
other characters are part of the id.

- `explosion.wav` gives id `explosion`
- `pong_wall.wav` gives id `pong_wall`
- `jump-soft.wav` gives id `jump`; `-soft` is ignored

Ids are at most 16 characters and must be unique across the folder.

Supported formats: `.wav`, `.mp3`, `.ogg`

## Usage in Games

```typescript
import { playSfx } from "../../sdk";

playSfx("pong_wall", 0.5); // volume 0.0 to 1.0
```

Sound effects can overlap. Audio only plays after the player has interacted
with the page (browser autoplay policy). In the editor's dev server, changes
to this folder reload the sounds without recompiling.

## Metadata (optional)

A `<file>.json` next to a file holds its tags, license and source, for the
editor's asset library:

```json
{ "tags": ["ui", "coin"], "license": "CC0", "source": "https://example.com/pack" }
```

Hosts ignore these files. The editor keeps keys it does not know (for
example `prompt` for a generated asset) and moves or deletes the sidecar with
its asset.
