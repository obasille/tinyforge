// The code agent's system prompt, in three layers:
// 1. TinyForge guidance: AGENTS.md and the SDK's exported API. The same on
//    every request, so it is cached.
// 2. The current game, sent with each request (it changes): its files, notes
//    and build status, and main.ts on the first request.
// 3. The rules of the task, below.

import { gameEntryPath } from '@tinyforge/engine/tooling/project-layout';
import type { ProjectFiles } from '../project-files.ts';
import type { SystemPart } from './provider.ts';

const RULES = `You are the code agent inside the TinyForge editor. You change one game at a time: the user's current game.

Rules:
- You change files in the current game's folder (games/<name>/), or in any game's when the request's context says the user allows it; only .ts and .md files. You can read every game, the SDK (engine/sdk/) and asset sidecars (assets/<kind>/<file>.json).
- Read a file before you change it. Prefer edit_file for small changes.
- Follow the TinyForge guide below: no allocation after init, all game state in RAM via the memory helpers, AssemblyScript types and casts.
- Use only asset IDs that exist (list_assets). An unknown ID is a compile error.
- When the game needs a sprite or a sound the library lacks, make it: make_sprite draws pixel art from a text grid, make_sound plays notes on the chiptune synthesizer the games' sounds were made with (sfx for effects, music for loops). Keep sprites small (8 to 32 pixels) and effects short (0.1 to 1 s). Replacing an asset that exists asks the user first. A game's cover (COVER in main.ts) is a 64x64 sprite.
- Compile before you finish, and fix every error. If the game should run, check game_log after compiling.
- games/<name>/NOTES.md holds the game's design notes. Read it when it exists, and update it when you make a design decision worth remembering.
- Sounds: the games' own sounds keep their synth recipe in their sidecar (\`spec\`, the input make_sound takes; list_assets says which have one). Read one to make a sound in the same style (effects: assets/sfx/tank_fire_p1.wav.json, assets/sfx/pong_score.wav.json; music: assets/music/pong_theme.wav.json), or to change a sound: edit its spec and make it again with the same ID.
- If the synth (or another tool) cannot make what the request needs, such as a wave, an envelope or an effect it lacks, say so in your reply and describe what is missing, so the user can add it. Do not silently settle for something else.
- Every change you make is one undo step for the user, so do the whole request, then stop.
- Reply briefly in plain prose: what you changed and anything the user should know. No code blocks unless asked.`;

/** The exported declarations of the SDK files: signatures and enums, without bodies. */
export function sdkApi(sources: Array<{ path: string; text: string }>): string {
  const out: string[] = [];
  for (const { path, text } of sources) {
    const decls: string[] = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('export ') || lines[i].startsWith('export *')) continue;
      const isEnum = /^export (const )?enum /.test(lines[i]);
      let decl = lines[i];
      // An enum keeps its members; a function its whole signature (it may span lines).
      while (i + 1 < lines.length && (isEnum ? !decl.includes('}') : !/[{;]/.test(decl))) {
        decl += `\n${lines[++i]}`;
      }
      decls.push(isEnum ? decl : decl.replace(/\s*\{.*$/s, ''));
    }
    if (decls.length > 0) out.push(`// ${path}\n${decls.join('\n')}`);
  }
  return out.join('\n\n');
}

/** Read the SDK's exported API through the Workspace. */
export async function readSdkApi(files: ProjectFiles): Promise<string> {
  const paths = files.files
    .map((f) => f.path)
    .filter((p) => /^engine\/sdk\/[^/]+\.ts$/.test(p) && !p.endsWith('.spec.ts') && !p.endsWith('/index.ts'));
  const sources = await Promise.all(paths.map(async (path) => ({ path, text: (await files.readText(path)) ?? '' })));
  return sdkApi(sources);
}

/** The cached part of the system prompt. `guide` is AGENTS.md. */
export function systemPrompt(guide: string, sdk: string): SystemPart[] {
  return [{ text: `${RULES}\n\n# TinyForge guide (AGENTS.md)\n\n${guide}\n\n# SDK API\n\n${sdk}`, cache: true }];
}

/**
 * What goes with a user's request: the game's files, notes and build, and
 * main.ts the first time. `shown` lists the files whose text it includes, so
 * the agent counts them as read.
 */
export async function gameContext(
  files: ProjectFiles,
  game: string,
  build: string,
  { first }: { first: boolean },
): Promise<{ text: string; shown: Array<{ path: string; text: string }> }> {
  const own = files.files.filter((f) => f.path.startsWith(`games/${game}/`)).map((f) => f.path);
  const parts = [`Current game: ${game}`, `Files:\n${own.join('\n')}`, `Last build: ${build}`];
  const shown: Array<{ path: string; text: string }> = [];
  const include = async (path: string) => {
    const text = await files.readText(path);
    if (text === null) return;
    parts.push(`${path}:\n${text.replace(/\r\n/g, '\n')}`);
    shown.push({ path, text });
  };
  await include(`games/${game}/NOTES.md`);
  if (first) await include(gameEntryPath(game));
  return { text: `<context>\n${parts.join('\n\n')}\n</context>`, shown };
}
