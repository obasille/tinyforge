# Music

Music tracks for TinyForge. They are not compiled into the cartridge: the host
loads every file in this folder at runtime and plays it when a game calls
`playMusic(id, volume)`.

## File Naming

`{id}-{info}.ext`

The id is everything before the first `-` (or the whole name). Underscores and
other characters are part of the id.

- `pong_theme.wav` gives id `pong_theme`
- `boss-battle.ogg` gives id `boss`; `-battle` is ignored

Ids are at most 16 characters and must be unique across the folder.

Supported formats: `.wav`, `.mp3`, `.ogg`

## Usage in Games

```typescript
import { playMusic, stopMusic } from "../sdk";

playMusic("pong_theme", 0.7); // loops until stopped or replaced
stopMusic();
```

Only one track plays at a time. Audio only plays after the player has
interacted with the page (browser autoplay policy), so start music after a
button press rather than in `init()`.
