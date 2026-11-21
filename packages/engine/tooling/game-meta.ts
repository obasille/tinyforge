// A game's metadata, declared as top-level constants in its main.ts:
//
//   const TITLE = "Pong";
//   const DESCRIPTION = "Two-player classic";
//   const AUTHOR = "Olivier";
//   const COVER = "pong_cover"; // optional, a sprite ID from the library
//   const RAM_SIZE: i32 = 0x2000; // optional, default DEFAULT_RAM_SIZE
//
// Each must be a literal. The compiler reads them before compiling (RAM_SIZE
// decides where static data starts) and the editor reads them for the game
// picker without compiling. Plain TS with no Node or DOM APIs.

import { DEFAULT_RAM_SIZE } from '../memory-map.ts';

export interface GameMeta {
  title: string;
  description: string;
  author: string;
  /** COVER sprite ID, or null. */
  cover: string | null;
  /** RAM_SIZE in bytes. */
  ram: number;
}

/** A metadata declaration that is missing or not a literal. */
// (No parameter properties: Node runs this file with type stripping only.)
export class GameMetaError extends Error {
  /** 1-based line of the declaration, or null when it is missing. */
  readonly line: number | null;

  constructor(message: string, line: number | null) {
    super(message);
    this.line = line;
  }
}

const TEXT_FIELDS = ['TITLE', 'DESCRIPTION', 'AUTHOR', 'COVER'] as const;
type TextField = (typeof TEXT_FIELDS)[number];

/** Largest RAM_SIZE a game can declare (256 MB). */
export const MAX_RAM_SIZE = 0x10000000;

function declaration(source: string, field: string): { text: string; line: number } | null {
  const m = new RegExp(`^const ${field}\\b.*$`, 'm').exec(source);
  if (!m) return null;
  return { text: m[0], line: source.slice(0, m.index).split('\n').length };
}

/** The string constants declared in a game's main.ts. */
export function readMetaFields(entry: string, source: string): Partial<Record<TextField, string>> {
  const values: Partial<Record<TextField, string>> = {};
  for (const field of TEXT_FIELDS) {
    const decl = declaration(source, field);
    if (!decl) continue;
    const literal = new RegExp(`^const ${field}(?::\\s*string)?\\s*=\\s*("(?:[^"\\\\]|\\\\.)*");\\s*(?://.*)?$`).exec(
      decl.text,
    );
    if (!literal) {
      throw new GameMetaError(`${entry}: ${field} must be a string literal, like: const ${field} = "...";`, decl.line);
    }
    values[field] = JSON.parse(literal[1]) as string;
  }
  return values;
}

/**
 * The game's RAM_SIZE (`const RAM_SIZE: i32 = 0x2000;`), or the default when
 * it declares none. A whole number literal, a multiple of 16.
 */
export function readRamSize(entry: string, source: string): number {
  const decl = declaration(source, 'RAM_SIZE');
  if (!decl) return DEFAULT_RAM_SIZE;
  const literal =
    /^const RAM_SIZE(?::\s*(?:i32|u32|usize))?\s*=\s*(0[xX][0-9a-fA-F_]+|[0-9][0-9_]*)\s*;\s*(?:\/\/.*)?$/.exec(
      decl.text,
    );
  if (!literal) {
    throw new GameMetaError(
      `${entry}: RAM_SIZE must be a number literal, like: const RAM_SIZE: i32 = 0x2000;`,
      decl.line,
    );
  }
  const value = Number(literal[1].replace(/_/g, ''));
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_RAM_SIZE || value % 16 !== 0) {
    throw new GameMetaError(
      `${entry}: RAM_SIZE must be a multiple of 16 between 16 and ${MAX_RAM_SIZE} bytes`,
      decl.line,
    );
  }
  return value;
}

/**
 * Read a game's metadata from its main.ts. TITLE, DESCRIPTION and AUTHOR are
 * required. Throws a GameMetaError, reported like a compile error.
 */
export function parseGameMeta(entry: string, source: string): GameMeta {
  const values = readMetaFields(entry, source);
  const ram = readRamSize(entry, source);
  for (const field of ['TITLE', 'DESCRIPTION', 'AUTHOR'] as const) {
    if (!values[field]) {
      throw new GameMetaError(`${entry}: missing game metadata, add: const ${field} = "...";`, null);
    }
  }
  return {
    title: values.TITLE ?? '',
    description: values.DESCRIPTION ?? '',
    author: values.AUTHOR ?? '',
    cover: values.COVER ?? null,
    ram,
  };
}

/** The COVER sprite ID, or null (also when the declarations do not parse). */
export function coverIdOf(source: string): string | null {
  try {
    return readMetaFields('main.ts', source).COVER ?? null;
  } catch {
    return null;
  }
}
