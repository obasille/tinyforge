// Compile a TinyForge game into a cartridge: game files in, a `.wasm` with its
// `tinyforge.meta` section out.
//
// Plain TS with no Node or DOM APIs: files come through `CompilerFiles`, so
// the same code runs in the editor's compile Worker (files from the
// Workspace) and in Node (compile-game.ts, files from disk) for the CLI
// builds and the tests.
//
// It uses the options in games/asconfig.json (stub runtime, imported memory)
// plus its "debug" or "release" target, and sets memoryBase to RAM_START +
// the game's RAM_SIZE, so static data starts right after the game's RAM.
//
// The asset scan (asset-scan.ts) runs as a compiler hook: an unknown asset ID
// is a compile error, and the IDs the game uses go into its metadata, with
// TITLE, DESCRIPTION, AUTHOR, the COVER image and RAM_SIZE (game-meta.ts).

import { LAYOUT_VERSION, RAM_START } from '../memory-map.ts';
import { type AssetKind, assetId, createAssetScan, libraryFromFiles } from './asset-scan.ts';
import { type CartridgeMeta, importedMemory, shiftSourceMap, withMeta } from './cartridge-meta.ts';
import { GameMetaError, parseGameMeta } from './game-meta.ts';
import {
  ASCONFIG_PATH,
  compilerPath,
  GAME_NAME,
  gameEntryPath,
  normalizePath,
  projectPathOf,
} from './project-layout.ts';

export type CompileTarget = 'debug' | 'release';

/** Read access to project files (see project-layout.ts). Null when missing. */
export interface CompilerFiles {
  readText(path: string): Promise<string | null>;
  readBytes(path: string): Promise<Uint8Array | null>;
}

/** A compiler message at a place in a project file. */
export interface Diagnostic {
  /** Project path, or null when the message has no file. */
  path: string | null;
  /** 1-based line and column of the start. */
  line: number;
  column: number;
  /** Character offsets in the file. */
  from: number;
  to: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export type CompileResult =
  | {
      ok: true;
      wasm: Uint8Array<ArrayBuffer>;
      /** Debug builds: source map whose sources are project paths. */
      sourceMap: string | null;
      meta: CartridgeMeta;
      log: string;
      diagnostics: Diagnostic[];
    }
  | { ok: false; log: string; diagnostics: Diagnostic[] };

export interface CompileRequest {
  game: string;
  target: CompileTarget;
  files: CompilerFiles;
  /** File names in assets/sprites, assets/sfx and assets/music. */
  assetFiles: Record<AssetKind, readonly string[]>;
}

interface AsConfig {
  options?: Record<string, unknown>;
  targets?: Record<string, Record<string, unknown>>;
}

/** asc command-line flags for asconfig.json's options plus one target. */
export function configArgs(config: AsConfig, target: CompileTarget): string[] {
  const options = { ...config.options, ...config.targets?.[target] };
  const args: string[] = [];
  for (const [key, value] of Object.entries(options)) {
    if (value === true) args.push(`--${key}`);
    else if (typeof value === 'number' || typeof value === 'string') args.push(`--${key}`, String(value));
  }
  return args;
}

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

// AssemblyScript's DiagnosticCategory (a const enum in its typings).
const CATEGORY_ERROR = 3;
const CATEGORY_WARNING = 2;

interface AscRange {
  start: number;
  end: number;
  source: { normalizedPath: string } | null;
}

function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}

function fail(log: string, diagnostics: Diagnostic[]): CompileResult {
  return { ok: false, log, diagnostics };
}

/** Compile one game. Never throws for compile errors; they are in `log` and `diagnostics`. */
export async function compile({ game, target, files, assetFiles }: CompileRequest): Promise<CompileResult> {
  const entry = gameEntryPath(game);
  if (!GAME_NAME.test(game)) return fail(`Invalid game name "${game}"\n`, []);
  const entrySource = await files.readText(entry);
  if (entrySource === null) return fail(`Unknown game "${game}": no ${entry}\n`, []);
  const configText = await files.readText(ASCONFIG_PATH);
  if (configText === null) return fail(`Missing ${ASCONFIG_PATH}\n`, []);

  // Metadata first: RAM_SIZE decides where static data starts.
  let gameMeta: ReturnType<typeof parseGameMeta>;
  let cover: CartridgeMeta['cover'] = null;
  try {
    gameMeta = parseGameMeta(entry, entrySource);
    if (gameMeta.cover) {
      const id = gameMeta.cover;
      const file = assetFiles.sprites.find((f) => IMAGE_TYPES[extension(f)] && assetId(f) === id);
      const bytes = file ? await files.readBytes(`assets/sprites/${file}`) : null;
      if (!file || !bytes) throw new GameMetaError(`${entry}: COVER sprite "${id}" not found in assets/sprites`, null);
      cover = { type: IMAGE_TYPES[extension(file)], bytes };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const line = e instanceof GameMetaError ? (e.line ?? 1) : 1;
    return fail(`${message}\n`, [lineDiagnostic(entry, entrySource, line, message)]);
  }

  const asc = (await import('assemblyscript/asc')).default;
  const scan = createAssetScan(libraryFromFiles(assetFiles));
  const outName = `${game}.wasm`;
  const outputs = new Map<string, Uint8Array | string>();
  const diagnostics: Diagnostic[] = [];
  /** Texts the compiler read, to turn diagnostic offsets into lines. */
  const texts = new Map<string, string>();
  let log = '';
  const sink = {
    write(chunk: string | Uint8Array) {
      log += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    },
  };

  const { error } = await asc.main(
    [
      `assembly/${entry}`,
      ...configArgs(JSON.parse(configText) as AsConfig, target),
      '--outFile',
      outName,
      '--memoryBase',
      String(RAM_START + gameMeta.ram),
    ],
    {
      // asc instantiates class transforms and uses objects as they are; its
      // typings only describe the class form.
      transforms: [scan.transform as unknown as import('assemblyscript/transform').Transform],
      stdout: sink,
      stderr: sink,
      readFile: async (filename: string, baseDir: string) => {
        const project = projectPathOf(normalizePath(`${baseDir}/${filename}`));
        if (!project || !compilerPath(project)) return null;
        const text = await files.readText(project);
        if (text !== null) texts.set(project, text);
        return text;
      },
      writeFile(filename: string, contents: Uint8Array | string) {
        outputs.set(filename.split('/').pop() ?? filename, contents);
      },
      listFiles: () => [],
      reportDiagnostic(d) {
        const range = d.range as AscRange | null;
        const severity = d.category === CATEGORY_ERROR ? 'error' : d.category === CATEGORY_WARNING ? 'warning' : 'info';
        const path = range?.source ? projectPathOf(range.source.normalizedPath) : null;
        const text = path === null ? undefined : texts.get(path);
        if (!range || path === null || text === undefined) {
          diagnostics.push({ path, line: 1, column: 1, from: 0, to: 0, severity, message: d.message });
          return;
        }
        const { line, column } = lineColumn(text, range.start);
        diagnostics.push({
          path,
          line,
          column,
          from: range.start,
          to: range.end,
          severity,
          message: d.message,
        });
      },
    },
  );

  // Name files in messages by project path, as the editor shows them.
  log = log.replace(/\bassembly\/games\//g, 'games/').replace(/\bassembly\/sdk\//g, 'engine/sdk/');
  const wasm = outputs.get(outName);
  if (error || !(wasm instanceof Uint8Array)) return fail(log || String(error ?? 'No output produced'), diagnostics);
  const memory = importedMemory(wasm);
  if (!memory) return fail(`${log}${game}: the module imports no memory\n`, diagnostics);
  const meta: CartridgeMeta = {
    title: gameMeta.title,
    description: gameMeta.description,
    author: gameMeta.author,
    cover,
    ram: gameMeta.ram,
    layout: LAYOUT_VERSION,
    memory: memory.min * 65536,
    assets: scan.used(),
  };
  const withSection = withMeta(new Uint8Array(wasm), meta);
  const map = outputs.get(`${outName}.map`);
  return {
    ok: true,
    wasm: withSection.wasm as Uint8Array<ArrayBuffer>,
    sourceMap:
      map === undefined
        ? null
        : shiftSourceMap(
            projectSources(typeof map === 'string' ? map : new TextDecoder().decode(map)),
            withSection.inserted,
          ),
    meta,
    log,
    diagnostics,
  };
}

function extension(file: string): string {
  return file.slice(file.lastIndexOf('.') + 1).toLowerCase();
}

function lineDiagnostic(path: string, text: string, line: number, message: string): Diagnostic {
  const lines = text.split('\n');
  const from = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  return {
    path,
    line,
    column: 1,
    from,
    to: from + (lines[line - 1]?.length ?? 0),
    severity: 'error',
    message,
  };
}

/** Name the source map's sources by project path; `~lib/` (the standard library) is left as is. */
function projectSources(mapJson: string): string {
  const map = JSON.parse(mapJson) as { sources?: string[] };
  map.sources = map.sources?.map((s) => (s.startsWith('~lib/') ? s : (projectPathOf(s) ?? s)));
  return JSON.stringify(map);
}
