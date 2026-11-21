// The asset library: a sprite grid, sound lists, search by ID, file name or
// tag, and which games use each asset. Drop files anywhere on the panel (or
// use Import) to add them: each file gets an ID check and, for a sprite, a
// sheet-split preview before anything is written. Edits are undoable
// (Ctrl+Z outside a text field) and never use a browser dialog.

import {
  draftImport,
  frameSize,
  type ImportDraft,
  idProblem,
  importProblems,
  type LibraryAsset,
  matchesSearch,
  replacedBy,
  type Sidecar,
  suggestedSheet,
  tagCounts,
  targetFile,
} from '@tinyforge/editor-core';
import type { AssetKind } from '@tinyforge/engine/tooling/asset-scan';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../EditorContext.ts';
import { useStore } from '../hooks.ts';

const KINDS: Array<{ kind: AssetKind; label: string }> = [
  { kind: 'sprites', label: 'Sprites' },
  { kind: 'sfx', label: 'Sound effects' },
  { kind: 'music', label: 'Music' },
];

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Tags typed as text: separated by commas or spaces, a leading # dropped. */
function parseTags(text: string): string[] {
  const tags = text
    .split(/[,\s]+/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean);
  return [...new Set(tags)];
}

/** One sound playing at a time, at the editor's master volume. */
function useSoundPlayer() {
  const editor = useEditor();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (asset: LibraryAsset) => {
    audio.current?.pause();
    if (playing === asset.path) {
      setPlaying(null);
      return;
    }
    const { volume, muted } = editor.audioSettings.getState();
    const a = new Audio(asset.url);
    a.volume = muted ? 0 : volume;
    a.onended = () => setPlaying((p) => (p === asset.path ? null : p));
    audio.current = a;
    setPlaying(asset.path);
    a.play().catch(() => setPlaying(null));
  };
  return { playing, toggle };
}

/** A sprite image scaled to fit `box` pixels, with an optional frame grid on top. */
function SpriteView({
  url,
  cols = 1,
  rows = 1,
  box,
  grid = false,
  onSize,
}: {
  url: string;
  cols?: number;
  rows?: number;
  box: number;
  grid?: boolean;
  onSize?: (w: number, h: number) => void;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const scale = size ? Math.min(box / size.w, box / size.h) : 1;
  // Whole-number zoom for small sprites keeps the pixels square.
  const zoom = scale >= 1 ? Math.max(1, Math.floor(scale)) : scale;
  const style: CSSProperties = size
    ? { width: size.w * zoom, height: size.h * zoom }
    : { maxWidth: box, maxHeight: box };
  const gridStyle: CSSProperties = {
    backgroundSize: `${100 / cols}% ${100 / rows}%`,
  };
  return (
    <span className="tf-lib-sprite" style={style}>
      <img
        src={url}
        alt=""
        draggable={false}
        style={style}
        onLoad={(e) => {
          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
          setSize({ w, h });
          onSize?.(w, h);
        }}
      />
      {grid && (cols > 1 || rows > 1) ? <span className="tf-lib-grid" style={gridStyle} /> : null}
    </span>
  );
}

/** The frames of a sheet, played in order, to check the split. */
function FramePlayer({
  url,
  cols,
  rows,
  width,
  height,
}: {
  url: string;
  cols: number;
  rows: number;
  width: number;
  height: number;
}) {
  const [frame, setFrame] = useState(0);
  const count = cols * rows;
  useEffect(() => {
    setFrame(0);
    if (count < 2) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % count), 150);
    return () => clearInterval(timer);
  }, [count]);
  const fw = width / cols;
  const fh = height / rows;
  const zoom = Math.max(1, Math.floor(64 / Math.max(fw, fh)));
  const col = frame % cols;
  const row = Math.floor(frame / cols);
  return (
    <span className="tf-lib-frames">
      <span
        className="tf-lib-frame"
        style={{
          width: fw * zoom,
          height: fh * zoom,
          backgroundImage: `url("${url}")`,
          backgroundSize: `${width * zoom}px ${height * zoom}px`,
          backgroundPosition: `${-col * fw * zoom}px ${-row * fh * zoom}px`,
        }}
      />
      <span className="tf-lib-muted">
        frame {frame + 1}/{count} · {fw}×{fh}
      </span>
    </span>
  );
}

export function LibraryPanel() {
  const editor = useEditor();
  const { assets, ready } = useStore(editor.assets.state);
  const { writable } = useStore(editor.files.state);
  const focus = useStore(editor.assetFocus);
  const game = useStore(editor.project).game;
  const [kind, setKind] = useState<AssetKind>('sprites');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const sound = useSoundPlayer();

  // The file tree (or another panel) asked to show an asset.
  useEffect(() => {
    if (!focus) return;
    const asset = assets.find((a) => a.path === focus);
    if (!asset) return;
    setKind(asset.kind);
    setSelected(asset.path);
    setQuery('');
    editor.assetFocus.setState(null);
  }, [editor, focus, assets]);

  const ofKind = useMemo(() => assets.filter((a) => a.kind === kind), [assets, kind]);
  const shown = useMemo(() => ofKind.filter((a) => matchesSearch(a, query)), [ofKind, query]);
  const tags = useMemo(() => tagCounts(ofKind), [ofKind]);
  const current = assets.find((a) => a.path === selected) ?? null;
  const counts = Object.fromEntries(KINDS.map(({ kind: k }) => [k, assets.filter((a) => a.kind === k).length]));
  const activeTags = new Set(
    query
      .split(/\s+/)
      .filter((w) => w.startsWith('#'))
      .map((w) => w.slice(1).toLowerCase()),
  );

  const toggleTag = (tag: string) => {
    const word = `#${tag}`;
    const words = query.split(/\s+/).filter(Boolean);
    const has = words.some((w) => w.toLowerCase() === word.toLowerCase());
    setQuery((has ? words.filter((w) => w.toLowerCase() !== word.toLowerCase()) : [...words, word]).join(' '));
  };

  const addFiles = async (list: FileList | File[]) => {
    setError(null);
    const added: ImportDraft[] = [];
    for (const file of [...list]) added.push(draftImport(file.name, new Uint8Array(await file.arrayBuffer())));
    if (added.length === 0) return;
    setDrafts((d) => [...d, ...added]);
    const first = added.find((d) => d.kind);
    if (first?.kind) setKind(first.kind);
  };

  const canImport = writable && ready;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the panel is a drop target for files; Import… is the keyboard path
    <div
      className={`tf-lib${dragging ? ' tf-lib-dragging' : ''}`}
      data-testid="library"
      onDragOver={(e) => {
        if (!canImport || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!canImport) return;
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      <div className="tf-lib-bar">
        <div className="tf-lib-tabs" role="tablist">
          {KINDS.map(({ kind: k, label }) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              className={kind === k ? 'tf-lib-tab tf-lib-tab-on' : 'tf-lib-tab'}
              data-testid={`library-tab-${k}`}
              onClick={() => setKind(k)}
            >
              {label} <span className="tf-lib-muted">{counts[k]}</span>
            </button>
          ))}
        </div>
        <input
          className="tf-lib-search"
          type="search"
          placeholder="Search ID, file or #tag"
          value={query}
          data-testid="library-search"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {canImport ? (
          <>
            <button type="button" data-testid="library-import" onClick={() => fileInput.current?.click()}>
              Import…
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept=".png,.jpg,.jpeg,.wav,.mp3,.ogg"
              data-testid="library-file-input"
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </>
        ) : null}
      </div>
      {tags.length > 0 ? (
        <div className="tf-lib-tags">
          {tags.map(({ tag, count }) => (
            <button
              key={tag}
              type="button"
              className={activeTags.has(tag.toLowerCase()) ? 'tf-lib-chip tf-lib-chip-on' : 'tf-lib-chip'}
              onClick={() => toggleTag(tag)}
            >
              #{tag} <span className="tf-lib-muted">{count}</span>
            </button>
          ))}
        </div>
      ) : null}
      {error ? <div className="tf-lib-error">{error}</div> : null}
      {drafts.length > 0 ? (
        <ImportView
          drafts={drafts}
          assets={assets}
          onChange={setDrafts}
          onDone={(paths) => {
            setDrafts([]);
            if (paths[0]) setSelected(paths[0]);
          }}
        />
      ) : (
        <div className="tf-lib-main">
          <div className="tf-lib-list">
            {!ready ? <div className="tf-lib-empty">Reading the library…</div> : null}
            {ready && shown.length === 0 ? (
              <div className="tf-lib-empty">
                {ofKind.length === 0 ? 'Nothing here yet.' : 'No asset matches the search.'}
                {canImport ? ' Drop files here to import them.' : ''}
              </div>
            ) : null}
            {kind === 'sprites' ? (
              <div className="tf-lib-grid-list">
                {shown.map((a) => (
                  <button
                    key={a.path}
                    type="button"
                    className={`tf-lib-card${a.path === selected ? ' tf-lib-selected' : ''}`}
                    data-testid={`asset-${a.path}`}
                    title={a.file}
                    onClick={() => setSelected(a.path)}
                  >
                    <span className="tf-lib-thumb">
                      <SpriteView url={a.url} box={64} />
                    </span>
                    <span className="tf-lib-card-id">{a.id}</span>
                    <span className="tf-lib-card-meta">
                      {a.cols > 1 || a.rows > 1 ? <span className="tf-lib-badge">{`${a.cols}×${a.rows}`}</span> : null}
                      {a.issues.length > 0 ? <span className="tf-lib-badge tf-lib-badge-warn">!</span> : null}
                      <UsedBadge asset={a} game={game} />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="tf-lib-sounds">
                {shown.map((a) => (
                  <div key={a.path} className={`tf-lib-sound${a.path === selected ? ' tf-lib-selected' : ''}`}>
                    <button
                      type="button"
                      className="tf-lib-play"
                      aria-label={sound.playing === a.path ? `Stop ${a.id}` : `Play ${a.id}`}
                      onClick={() => sound.toggle(a)}
                    >
                      {sound.playing === a.path ? '■' : '▶'}
                    </button>
                    <button
                      type="button"
                      className="tf-lib-sound-name"
                      data-testid={`asset-${a.path}`}
                      title={a.file}
                      onClick={() => setSelected(a.path)}
                    >
                      <span className="tf-lib-card-id">{a.id}</span>
                      <span className="tf-lib-muted">{formatBytes(a.size)}</span>
                      {(a.sidecar?.tags ?? []).map((t) => (
                        <span key={t} className="tf-lib-badge">
                          #{t}
                        </span>
                      ))}
                      {a.issues.length > 0 ? <span className="tf-lib-badge tf-lib-badge-warn">!</span> : null}
                      <UsedBadge asset={a} game={game} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {current ? (
            <Details
              key={current.path}
              asset={current}
              assets={assets}
              writable={writable}
              playing={sound.playing === current.path}
              onPlay={() => sound.toggle(current)}
              onSelect={setSelected}
            />
          ) : null}
        </div>
      )}
      {dragging ? <div className="tf-lib-drop">Drop images or sounds to import them</div> : null}
    </div>
  );
}

function UsedBadge({ asset, game }: { asset: LibraryAsset; game: string | null }) {
  if (asset.usedBy.length === 0) {
    return <span className="tf-lib-badge tf-lib-badge-unused">unused</span>;
  }
  const here = game && asset.usedBy.includes(game);
  return (
    <span
      className={here ? 'tf-lib-badge tf-lib-badge-here' : 'tf-lib-badge'}
      title={`Used by ${asset.usedBy.join(', ')}`}
    >
      {asset.usedBy.length === 1 ? asset.usedBy[0] : `${asset.usedBy.length} games`}
    </span>
  );
}

function Details({
  asset,
  assets,
  writable,
  playing,
  onPlay,
  onSelect,
}: {
  asset: LibraryAsset;
  assets: LibraryAsset[];
  writable: boolean;
  playing: boolean;
  onPlay: () => void;
  onSelect: (path: string | null) => void;
}) {
  const editor = useEditor();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [tags, setTags] = useState((asset.sidecar?.tags ?? []).join(', '));
  const [license, setLicense] = useState(asset.sidecar?.license ?? '');
  const [source, setSource] = useState(asset.sidecar?.source ?? '');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Show the saved values again when the sidecar changes on disk.
  const savedKey = JSON.stringify(asset.sidecar);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the saved sidecar changes
  useEffect(() => {
    setTags((asset.sidecar?.tags ?? []).join(', '));
    setLicense(asset.sidecar?.license ?? '');
    setSource(asset.sidecar?.source ?? '');
  }, [savedKey]);

  const sidecar: Sidecar = {
    ...(asset.sidecar ?? {}),
    tags: parseTags(tags).length > 0 ? parseTags(tags) : undefined,
    license: license.trim() || undefined,
    source: source.trim() || undefined,
  };
  const changed =
    (sidecar.tags ?? []).join(',') !== (asset.sidecar?.tags ?? []).join(',') ||
    (sidecar.license ?? '') !== (asset.sidecar?.license ?? '') ||
    (sidecar.source ?? '') !== (asset.sidecar?.source ?? '');

  const run = (action: Promise<void>, after?: () => void) => {
    setError(null);
    action.then(after, (e: unknown) => setError(errorText(e)));
  };

  const renameProblem = (id: string) => {
    const problem = idProblem(id);
    if (problem) return problem;
    if (id !== asset.id && assets.some((a) => a.kind === asset.kind && a.id === id)) return `"${id}" is already used`;
    return null;
  };

  const commitRename = (id: string) => {
    if (id === asset.id) return setRenaming(null);
    const problem = renameProblem(id);
    if (problem) return setError(problem);
    const to = `assets/${asset.kind}/${id}${asset.file.slice(asset.id.length)}`;
    run(editor.workbench.rename(asset.path, to), () => {
      setRenaming(null);
      onSelect(to);
    });
  };

  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

  return (
    <aside className="tf-lib-details" data-testid="library-details">
      <div className="tf-lib-preview">
        {asset.kind === 'sprites' ? (
          <>
            <SpriteView
              url={asset.url}
              cols={asset.cols}
              rows={asset.rows}
              box={160}
              grid
              onSize={(w, h) => setSize({ w, h })}
            />
            {size && (asset.cols > 1 || asset.rows > 1) ? (
              <FramePlayer url={asset.url} cols={asset.cols} rows={asset.rows} width={size.w} height={size.h} />
            ) : null}
          </>
        ) : (
          <button type="button" className="tf-lib-play tf-lib-play-big" onClick={onPlay}>
            {playing ? '■ Stop' : '▶ Play'}
          </button>
        )}
      </div>
      {renaming !== null ? (
        <input
          className="tf-lib-id-input"
          data-testid="library-rename"
          // biome-ignore lint/a11y/noAutofocus: the input appears because the user asked to rename
          autoFocus
          value={renaming}
          maxLength={32}
          onChange={(e) => setRenaming(e.target.value)}
          onKeyDown={(e) => {
            stop(e);
            if (e.key === 'Enter') commitRename(renaming.trim());
            if (e.key === 'Escape') setRenaming(null);
          }}
        />
      ) : (
        <h3 className="tf-lib-title" data-testid="library-details-id">
          {asset.id}
        </h3>
      )}
      {renaming !== null && renameProblem(renaming.trim()) ? (
        <div className="tf-lib-problem">{renameProblem(renaming.trim())}</div>
      ) : null}
      {renaming !== null && asset.usedBy.length > 0 ? (
        <div className="tf-lib-warn">
          {asset.usedBy.join(', ')} still use{asset.usedBy.length === 1 ? 's' : ''} "{asset.id}": change the code too.
        </div>
      ) : null}
      <dl className="tf-lib-facts">
        <dt>File</dt>
        <dd title={asset.path}>{asset.file}</dd>
        <dt>Size</dt>
        <dd>
          {formatBytes(asset.size)}
          {size ? ` · ${size.w}×${size.h}` : ''}
        </dd>
        {asset.kind === 'sprites' && (asset.cols > 1 || asset.rows > 1) ? (
          <>
            <dt>Sheet</dt>
            <dd>
              {asset.cols}×{asset.rows} frames
              {size ? ` of ${size.w / asset.cols}×${size.h / asset.rows}` : ''}
            </dd>
          </>
        ) : null}
        <dt>Used by</dt>
        <dd data-testid="library-used-by">
          {asset.usedBy.length === 0 ? (
            <span className="tf-lib-muted">no game</span>
          ) : (
            asset.usedBy.map((g) => (
              <button
                key={g}
                type="button"
                className="tf-lib-link"
                title={`Open ${g}`}
                onClick={() => editor.selectGame(g)}
              >
                {g}
              </button>
            ))
          )}
        </dd>
      </dl>
      {asset.issues.map((issue) => (
        <div key={issue} className="tf-lib-warn">
          {issue}
        </div>
      ))}
      <fieldset className="tf-lib-meta" disabled={!writable}>
        <label>
          Tags
          <input
            value={tags}
            placeholder="ui, coin, retro"
            onChange={(e) => setTags(e.target.value)}
            onKeyDown={stop}
          />
        </label>
        <label>
          License
          <input
            value={license}
            placeholder="CC0, CC-BY 4.0…"
            onChange={(e) => setLicense(e.target.value)}
            onKeyDown={stop}
          />
        </label>
        <label>
          Source
          <input
            value={source}
            placeholder="Author, URL or tool"
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={stop}
          />
        </label>
        {typeof asset.sidecar?.prompt === 'string' ? (
          <div className="tf-lib-prompt">
            <span className="tf-lib-muted">Prompt</span> {asset.sidecar.prompt}
          </div>
        ) : null}
        {writable ? (
          <button
            type="button"
            data-testid="library-save-info"
            disabled={!changed}
            onClick={() => run(editor.workbench.saveSidecar(asset.path, sidecar))}
          >
            Save info
          </button>
        ) : null}
      </fieldset>
      {writable ? (
        <div className="tf-lib-actions">
          {confirmDelete ? (
            <>
              <span>
                Delete {asset.file}
                {asset.usedBy.length > 0 ? ` (used by ${asset.usedBy.join(', ')})` : ''}?
              </span>
              <button
                type="button"
                className="tf-lib-danger"
                data-testid="library-delete-confirm"
                onClick={() => run(editor.workbench.delete(asset.path), () => onSelect(null))}
              >
                Delete
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </>
          ) : (
            <>
              <button type="button" data-testid="library-rename-start" onClick={() => setRenaming(asset.id)}>
                Rename ID
              </button>
              <button type="button" data-testid="library-delete" onClick={() => setConfirmDelete(true)}>
                Delete…
              </button>
            </>
          )}
        </div>
      ) : null}
      {error ? <div className="tf-lib-error">{error}</div> : null}
    </aside>
  );
}

/** The files being imported, each with its checks and (for a sprite) the sheet split. */
function ImportView({
  drafts,
  assets,
  onChange,
  onDone,
}: {
  drafts: ImportDraft[];
  assets: LibraryAsset[];
  onChange: (drafts: ImportDraft[]) => void;
  onDone: (paths: string[]) => void;
}) {
  const editor = useEditor();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problems = drafts.map((d) => importProblems(d, assets, drafts));
  const ready = drafts.filter((_, i) => problems[i].length === 0);
  const update = (i: number, patch: Partial<ImportDraft>) =>
    onChange(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const submit = () => {
    setBusy(true);
    setError(null);
    editor.workbench.importAssets(ready, assets).then(
      () => {
        setBusy(false);
        onDone(ready.map((d) => `assets/${d.kind}/${targetFile(d)}`));
      },
      (e: unknown) => {
        setBusy(false);
        setError(errorText(e));
      },
    );
  };

  return (
    <div className="tf-lib-import" data-testid="library-import-view">
      <div className="tf-lib-import-list">
        {drafts.map((d, i) => (
          <DraftCard
            // biome-ignore lint/suspicious/noArrayIndexKey: drafts have no ID of their own and are only appended or removed
            key={i}
            draft={d}
            problems={problems[i]}
            replaces={d.kind ? replacedBy(d, assets) : []}
            onChange={(patch) => update(i, patch)}
            onRemove={() => onChange(drafts.filter((_, j) => j !== i))}
          />
        ))}
      </div>
      <div className="tf-lib-import-bar">
        {error ? <span className="tf-lib-error">{error}</span> : null}
        <span className="tf-lib-muted">
          {ready.length < drafts.length ? `${drafts.length - ready.length} file(s) need a fix and are skipped.` : ''}
        </span>
        <button type="button" onClick={() => onChange([])}>
          Cancel
        </button>
        <button
          type="button"
          data-testid="library-import-confirm"
          disabled={busy || ready.length === 0}
          onClick={submit}
        >
          {ready.length === 1 ? 'Import 1 file' : `Import ${ready.length} files`}
        </button>
      </div>
    </div>
  );
}

function DraftCard({
  draft,
  problems,
  replaces,
  onChange,
  onRemove,
}: {
  draft: ImportDraft;
  problems: string[];
  replaces: LibraryAsset[];
  onChange: (patch: Partial<ImportDraft>) => void;
  onRemove: () => void;
}) {
  // Created in an effect so its cleanup (also run by StrictMode) never leaves a revoked URL in use.
  const [url, setUrl] = useState('');
  useEffect(() => {
    const type = draft.kind === 'sprites' ? (draft.ext === 'png' ? 'image/png' : 'image/jpeg') : '';
    const next = URL.createObjectURL(new Blob([draft.bytes as BlobPart], type ? { type } : {}));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [draft.bytes, draft.kind, draft.ext]);
  const frame = frameSize(draft);
  const suggestion = suggestedSheet(draft.image);
  const showSuggestion = suggestion && (suggestion.cols !== draft.cols || suggestion.rows !== draft.rows);
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  const num = (v: string) => (v === '' ? 0 : Number(v));

  return (
    <div className={`tf-lib-draft${problems.length ? ' tf-lib-draft-bad' : ''}`} data-testid={`draft-${draft.name}`}>
      <div className="tf-lib-draft-preview">
        {!url ? null : draft.kind === 'sprites' && draft.image ? (
          <>
            <SpriteView url={url} cols={draft.cols} rows={draft.rows} box={128} grid />
            {frame ? (
              <FramePlayer
                url={url}
                cols={draft.cols}
                rows={draft.rows}
                width={draft.image.width}
                height={draft.image.height}
              />
            ) : null}
          </>
        ) : draft.kind ? (
          // biome-ignore lint/a11y/useMediaCaption: a sound effect preview has no captions
          <audio src={url} controls preload="none" />
        ) : (
          <span className="tf-lib-muted">No preview</span>
        )}
      </div>
      <div className="tf-lib-draft-fields">
        <div className="tf-lib-draft-head">
          <span className="tf-lib-draft-name" title={draft.name}>
            {draft.name}
          </span>
          <button type="button" className="tf-lib-x" aria-label={`Remove ${draft.name}`} onClick={onRemove}>
            ×
          </button>
        </div>
        {draft.kind ? (
          <div className="tf-lib-draft-row">
            <label>
              ID
              <input
                value={draft.id}
                data-testid="draft-id"
                maxLength={32}
                onChange={(e) => onChange({ id: e.target.value.trim() })}
                onKeyDown={stop}
              />
            </label>
            {draft.kind !== 'sprites' ? (
              <label>
                Kind
                <select
                  value={draft.kind}
                  onChange={(e) => onChange({ kind: e.target.value as AssetKind })}
                  onKeyDown={stop}
                >
                  <option value="sfx">Sound effect</option>
                  <option value="music">Music</option>
                </select>
              </label>
            ) : (
              <>
                <label>
                  Columns
                  <input
                    type="number"
                    min={1}
                    max={255}
                    value={draft.cols || ''}
                    data-testid="draft-cols"
                    onChange={(e) => onChange({ cols: num(e.target.value) })}
                    onKeyDown={stop}
                  />
                </label>
                <label>
                  Rows
                  <input
                    type="number"
                    min={1}
                    max={255}
                    value={draft.rows || ''}
                    data-testid="draft-rows"
                    onChange={(e) => onChange({ rows: num(e.target.value) })}
                    onKeyDown={stop}
                  />
                </label>
              </>
            )}
          </div>
        ) : null}
        {draft.kind ? (
          <div className="tf-lib-draft-row">
            <label className="tf-lib-grow">
              Tags
              <input
                defaultValue={draft.tags.join(', ')}
                placeholder="ui, coin"
                onChange={(e) => onChange({ tags: parseTags(e.target.value) })}
                onKeyDown={stop}
              />
            </label>
            <label>
              License
              <input
                value={draft.license}
                placeholder="CC0"
                onChange={(e) => onChange({ license: e.target.value })}
                onKeyDown={stop}
              />
            </label>
            <label>
              Source
              <input
                value={draft.source}
                placeholder="Author or URL"
                onChange={(e) => onChange({ source: e.target.value })}
                onKeyDown={stop}
              />
            </label>
          </div>
        ) : null}
        <div className="tf-lib-draft-info">
          {draft.image ? (
            <span>
              {draft.image.width}×{draft.image.height}
              {frame && (draft.cols > 1 || draft.rows > 1)
                ? ` → ${draft.cols * draft.rows} frames of ${frame.width}×${frame.height}`
                : ''}
            </span>
          ) : null}
          {draft.kind ? (
            <span className="tf-lib-muted">
              → assets/{draft.kind}/{targetFile(draft)}
            </span>
          ) : null}
          {showSuggestion && suggestion ? (
            <button type="button" className="tf-lib-link" onClick={() => onChange(suggestion)}>
              Split as {suggestion.cols}×{suggestion.rows}?
            </button>
          ) : null}
        </div>
        {problems.map((p) => (
          <div key={p} className="tf-lib-problem">
            {p}
          </div>
        ))}
        {replaces.length > 0 ? (
          <label className="tf-lib-replace">
            <input
              type="checkbox"
              checked={draft.replace}
              data-testid="draft-replace"
              onChange={(e) => onChange({ replace: e.target.checked })}
            />
            Replace {replaces.map((r) => r.file).join(', ')}
            {replaces.some((r) => r.usedBy.length > 0)
              ? ` (used by ${[...new Set(replaces.flatMap((r) => r.usedBy))].join(', ')})`
              : ''}
          </label>
        ) : null}
      </div>
    </div>
  );
}
