// The asset library as the editor shows it: every sprite, sound effect and
// music file with its ID, sheet layout, sidecar metadata (tags, license,
// source) and the games that use it.
//
// "Used by" comes from scanning each game's sources with the live asset scan
// (no compile), plus each game's COVER, plus the current game's open buffers.
// Plain TS: the library panel renders `state`.

import { ASSET_KINDS, type AssetKind } from '@tinyforge/engine/tooling/asset-scan';
import { coverIdOf } from '@tinyforge/engine/tooling/game-meta';
import { assetKindOf, gameOf } from '@tinyforge/engine/tooling/project-layout';
import { scanAssets } from './live-scan.ts';
import { type ProjectFiles, parseAssetName } from './project-files.ts';
import { createStore, type Store } from './store.ts';
import type { FileChange, FileEntry } from './workspace.ts';

/** Longest asset ID (the sprite table holds 16 characters). */
export const MAX_ID_LENGTH = 16;
const ID_PATTERN = /^[A-Za-z0-9_]+$/;

/** Why an ID cannot be used, or null when it is fine. */
export function idProblem(id: string): string | null {
  if (!id) return 'An ID is required';
  if (!ID_PATTERN.test(id)) return 'An ID uses only letters, digits and _';
  if (id.length > MAX_ID_LENGTH) return `An ID has at most ${MAX_ID_LENGTH} characters`;
  return null;
}

/** Optional metadata next to an asset file: `<file>.json`. Unknown keys are kept. */
export interface Sidecar {
  tags?: string[];
  license?: string;
  /** Where it comes from: an author, a URL, or the tool that made it. */
  source?: string;
  /** The prompt, for a generated asset. */
  prompt?: string;
  [key: string]: unknown;
}

export const sidecarPath = (path: string) => `${path}.json`;

export interface LibraryAsset {
  kind: AssetKind;
  id: string;
  /** File name in assets/<kind>/. */
  file: string;
  path: string;
  /** Sheet columns and rows (1×1 for a single sprite or a sound). */
  cols: number;
  rows: number;
  size: number;
  url: string;
  sidecar: Sidecar | null;
  /** Games whose code (or COVER) uses this asset. */
  usedBy: string[];
  /** Problems with the file name: an invalid or duplicate ID, a bad sheet format. */
  issues: string[];
}

export interface LibraryState {
  assets: LibraryAsset[];
  ready: boolean;
}

function parseFormat(format: string): { cols: number; rows: number } | null {
  if (!format) return { cols: 1, rows: 1 };
  const m = /^(\d+)x(\d+)$/.exec(format);
  if (!m) return null;
  const cols = Number(m[1]);
  const rows = Number(m[2]);
  return cols > 0 && rows > 0 ? { cols, rows } : null;
}

/** Whether an asset matches a search: every word must match its ID, file name or a tag; `#tag` matches a tag exactly. */
export function matchesSearch(asset: LibraryAsset, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const tags = (asset.sidecar?.tags ?? []).map((t) => t.toLowerCase());
  return words.every((w) => {
    if (w.startsWith('#')) return tags.includes(w.slice(1));
    return (
      asset.id.toLowerCase().includes(w) || asset.file.toLowerCase().includes(w) || tags.some((t) => t.includes(w))
    );
  });
}

/** Every tag in the library, with how many assets have it. */
export function tagCounts(assets: readonly LibraryAsset[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const a of assets) for (const t of a.sidecar?.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
}

const key = (kind: AssetKind, id: string) => `${kind}/${id}`;

export class AssetLibrary {
  readonly state: Store<LibraryState> = createStore<LibraryState>({ assets: [], ready: false });
  /** Asset key → games using it, from the files on disk. */
  private usage = new Map<string, Set<string>>();
  /** Per game: the asset keys its files use. */
  private usageByGame = new Map<string, Set<string>>();
  private sidecars = new Map<string, Sidecar | null>();
  /** The current game's assets from its open buffers (unsaved code). */
  private live: { game: string | null; keys: Set<string> } = { game: null, keys: new Set() };
  private refreshing: Promise<void> = Promise.resolve();

  constructor(private readonly files: ProjectFiles) {}

  /** Read the sidecars and scan every game; call once the file list is loaded. */
  start(): Promise<void> {
    return this.enqueue(async () => {
      await Promise.all(this.files.games.map((g) => this.scanGame(g)));
      await this.readSidecars(this.files.files.map((f) => f.path));
    });
  }

  /** Files changed: rescan the games and sidecars they touch. */
  filesChanged(changes: FileChange[]): Promise<void> {
    return this.enqueue(async () => {
      const games = new Set<string>();
      for (const c of changes) {
        const g = gameOf(c.path);
        if (g && c.path.endsWith('.ts')) games.add(g);
      }
      // A removed game no longer uses anything.
      for (const g of [...this.usageByGame.keys()]) if (!this.files.games.includes(g)) games.add(g);
      await Promise.all([...games].map((g) => this.scanGame(g)));
      await this.readSidecars(changes.map((c) => c.path));
    });
  }

  /** The current game's live uses (unsaved buffers), from the workbench. */
  setLiveUses(game: string | null, used: { sprites: string[]; sfx: string[]; music: string[] }): void {
    const keys = new Set<string>();
    for (const kind of ASSET_KINDS) for (const id of used[kind]) keys.add(key(kind, id));
    this.live = { game, keys };
    this.publish();
  }

  /** Resolves when pending scans are done (for tests). */
  idle(): Promise<void> {
    return this.refreshing;
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    this.refreshing = this.refreshing.then(work).then(
      () => this.publish(),
      () => this.publish(),
    );
    return this.refreshing;
  }

  private async scanGame(game: string): Promise<void> {
    const before = this.usageByGame.get(game) ?? new Set<string>();
    for (const k of before) this.usage.get(k)?.delete(game);
    this.usageByGame.delete(game);
    if (!this.files.games.includes(game)) return;
    const keys = new Set<string>();
    const sources = this.files.files.filter((f) => f.path.startsWith(`games/${game}/`) && f.path.endsWith('.ts'));
    await Promise.all(
      sources.map(async (f) => {
        const text = await this.files.readText(f.path);
        if (text === null) return;
        for (const use of scanAssets(text, null).uses) keys.add(key(use.kind, use.id));
        if (f.path === `games/${game}/main.ts`) {
          const cover = coverIdOf(text);
          if (cover) keys.add(key('sprites', cover));
        }
      }),
    );
    this.usageByGame.set(game, keys);
    for (const k of keys) {
      let set = this.usage.get(k);
      if (!set) {
        set = new Set();
        this.usage.set(k, set);
      }
      set.add(game);
    }
  }

  private async readSidecars(paths: string[]): Promise<void> {
    const wanted = new Set<string>();
    for (const p of paths) {
      if (assetKindOf(p)) wanted.add(p);
      else if (p.endsWith('.json') && assetKindOf(p.slice(0, -'.json'.length))) wanted.add(p.slice(0, -'.json'.length));
    }
    await Promise.all(
      [...wanted].map(async (p) => {
        const text = this.files.entry(sidecarPath(p)) ? await this.files.readText(sidecarPath(p)) : null;
        let sidecar: Sidecar | null = null;
        if (text !== null) {
          try {
            const parsed = JSON.parse(text) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) sidecar = parsed as Sidecar;
          } catch {
            sidecar = null;
          }
          if (sidecar && !Array.isArray(sidecar.tags)) sidecar = { ...sidecar, tags: [] };
        }
        this.sidecars.set(p, sidecar);
      }),
    );
  }

  private publish(): void {
    const assets: LibraryAsset[] = [];
    const seen = new Map<string, LibraryAsset[]>();
    for (const entry of this.files.files) {
      const kind = assetKindOf(entry.path);
      if (!kind) continue;
      assets.push(this.describe(kind, entry));
    }
    for (const a of assets) {
      const k = key(a.kind, a.id);
      seen.set(k, [...(seen.get(k) ?? []), a]);
    }
    for (const list of seen.values()) {
      if (list.length < 2) continue;
      for (const a of list) {
        const others = list.filter((o) => o !== a).map((o) => o.file);
        a.issues.push(`Same ID as ${others.join(', ')}: only one of them is used`);
      }
    }
    this.state.setState({ assets, ready: true });
  }

  private describe(kind: AssetKind, entry: FileEntry): LibraryAsset {
    const file = entry.path.slice(`assets/${kind}/`.length);
    const name = parseAssetName(file);
    const issues: string[] = [];
    const problem = idProblem(name.id);
    if (problem) issues.push(problem);
    const format = file.includes('~') ? name.format : '';
    const layout = parseFormat(format);
    if (!layout) issues.push(`"${format}" is not a sheet format like 8x1`);
    if (kind !== 'sprites' && format) issues.push('Only sprites have a sheet format');
    const k = key(kind, name.id);
    const usedBy = new Set(this.usage.get(k) ?? []);
    if (this.live.game && this.live.keys.has(k)) usedBy.add(this.live.game);
    return {
      kind,
      id: name.id,
      file,
      path: entry.path,
      cols: layout?.cols ?? 1,
      rows: layout?.rows ?? 1,
      size: entry.size,
      url: this.files.workspace.url(entry),
      sidecar: this.sidecars.get(entry.path) ?? null,
      usedBy: [...usedBy].sort(),
      issues,
    };
  }
}
