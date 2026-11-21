// Find the assets a game uses, and check them against the asset library.
//
// An AssemblyScript transform (an `afterParse` hook) that compileGame passes
// to the compiler, so every build runs it: the editor's dev server, the Vite
// production build and scripts/build-games.js.
//
// It looks at every call to s(), playSfx() and playMusic() in the game's own
// sources (games/<name>/**). The first argument must be a string literal, or a
// `cond ? "a" : "b"` choice between literals (the no-allocation rule already
// rules out anything built at run time), and each ID must be in the library.
// Anything else is a compile error at that argument, reported like any other
// AssemblyScript error. The IDs found are what the host loads for the game.
//
// Plain TS with no Node APIs and no import of the compiler (it is handed the
// parser), so the same code can run in a browser Worker later.

export type AssetKind = 'sprites' | 'sfx' | 'music';
export const ASSET_KINDS: readonly AssetKind[] = ['sprites', 'sfx', 'music'];

/** Asset IDs per kind, sorted. Also the shape of `assets` in tinyforge.meta. */
export type AssetList = Record<AssetKind, string[]>;

/** IDs available in the library, per kind. */
export type AssetLibrary = Record<AssetKind, ReadonlySet<string>>;

/** File name patterns of each kind in assets/<kind>/. */
export const ASSET_PATTERNS: Record<AssetKind, RegExp> = {
  sprites: /\.(png|jpe?g)$/i,
  sfx: /\.(wav|mp3|ogg)$/i,
  music: /\.(wav|mp3|ogg)$/i,
};

/** Asset ID of a library file name: the part before the first `~` or `-`. */
export function assetId(file: string): string {
  const name = file.replace(/\.[^/.]+$/, '');
  const tilde = name.indexOf('~');
  const dash = name.indexOf('-');
  return tilde >= 0 ? name.slice(0, tilde) : dash >= 0 ? name.slice(0, dash) : name;
}

/** Library IDs from the file names in each kind's folder. */
export function libraryFromFiles(files: Record<AssetKind, readonly string[]>): AssetLibrary {
  const lib = {} as Record<AssetKind, Set<string>>;
  for (const kind of ASSET_KINDS) {
    lib[kind] = new Set(files[kind].filter((f) => ASSET_PATTERNS[kind].test(f)).map(assetId));
  }
  return lib;
}

/** Which asset kind each SDK function takes as its first argument. */
const CALLS: Record<string, AssetKind> = { s: 'sprites', playSfx: 'sfx', playMusic: 'music' };

const NOUN: Record<AssetKind, string> = { sprites: 'sprite', sfx: 'sound effect', music: 'music track' };

// AssemblyScript's NodeKind, LiteralKind and DiagnosticCode values (const
// enums in its typings, so they are repeated here; a test checks them).
export const AS_CONSTANTS = {
  NodeKindIdentifier: 7,
  NodeKindCall: 10,
  NodeKindLiteral: 17,
  NodeKindParenthesized: 21,
  NodeKindTernary: 23,
  LiteralKindString: 2,
  DiagnosticUserDefined: 102,
} as const;

// The few parts of the AssemblyScript AST and parser this needs.
interface AstNode {
  kind: number;
  range: unknown;
  [key: string]: unknown;
}
interface Source {
  normalizedPath: string;
  statements: unknown;
}
export interface ParserLike {
  sources: Source[];
  error(code: number, range: unknown, arg0?: string): void;
}

/** Call `visit` on every AST node under `node`. */
function walk(node: unknown, visit: (n: AstNode) => void, seen = new Set<object>()): void {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, seen);
    return;
  }
  const n = node as AstNode;
  if (typeof n.kind === 'number') visit(n);
  for (const key of Object.keys(n)) {
    if (key === 'range' || key === 'parent') continue;
    walk(n[key], visit, seen);
  }
}

/** The string literals an argument can evaluate to, or null if it is not literal. */
function literalChoices(arg: AstNode): { value: string; node: AstNode }[] | null {
  const K = AS_CONSTANTS;
  if (arg.kind === K.NodeKindLiteral) {
    return arg.literalKind === K.LiteralKindString ? [{ value: arg.value as string, node: arg }] : null;
  }
  if (arg.kind === K.NodeKindParenthesized) return literalChoices(arg.expression as AstNode);
  if (arg.kind === K.NodeKindTernary) {
    const a = literalChoices(arg.ifThen as AstNode);
    const b = literalChoices(arg.ifElse as AstNode);
    return a && b ? [...a, ...b] : null;
  }
  return null;
}

const isGameSource = (source: Source) => /(^|\/)games\/[^/]+\//.test(source.normalizedPath);

/**
 * A transform that checks and collects the game's asset IDs. Pass `transform`
 * to asc (`asc.main(args, { transforms: [transform] })`); after compiling,
 * `used()` has the IDs found.
 */
export function createAssetScan(library: AssetLibrary): {
  transform: { afterParse(parser: ParserLike): void };
  used(): AssetList;
} {
  const found: Record<AssetKind, Set<string>> = { sprites: new Set(), sfx: new Set(), music: new Set() };
  const transform = {
    afterParse(parser: ParserLike) {
      const K = AS_CONSTANTS;
      for (const source of parser.sources) {
        if (!isGameSource(source)) continue;
        walk(source.statements, (node) => {
          if (node.kind !== K.NodeKindCall) return;
          const callee = node.expression as AstNode | undefined;
          if (callee?.kind !== K.NodeKindIdentifier) return;
          const fn = callee.text as string;
          const kind = CALLS[fn];
          if (!kind) return;
          const arg = (node.args as AstNode[])[0];
          if (!arg) return; // the compiler reports the missing argument
          const choices = literalChoices(arg);
          if (!choices) {
            parser.error(
              K.DiagnosticUserDefined,
              arg.range,
              `${fn}() needs the ${NOUN[kind]} ID as a string literal, like ${fn}("name").`,
            );
            return;
          }
          for (const { value, node: literal } of choices) {
            if (library[kind].has(value)) found[kind].add(value);
            else
              parser.error(
                K.DiagnosticUserDefined,
                literal.range,
                `Unknown ${NOUN[kind]} "${value}": no file with that ID in assets/${kind}.`,
              );
          }
        });
      }
    },
  };
  return {
    transform,
    used: () => ({
      sprites: [...found.sprites].sort(),
      sfx: [...found.sfx].sort(),
      music: [...found.music].sort(),
    }),
  };
}
