// The sprite editor: tools, palette and frames around a canvas that the
// plain-TS SpriteCanvas draws (editor-core sprite-canvas.ts). Edits have
// their own undo inside the panel; Save writes the PNG as one undoable file
// command, and a running game shows the new pixels right away.

import {
  browserDecodeImage,
  type Color,
  colorOf,
  cssOf,
  DEFAULT_PALETTE,
  FramePreview,
  hexOf,
  MAX_FRAME_SIDE,
  paintFrame,
  rgbaOf,
  SpriteCanvas,
  SpriteEditor,
  type SpriteTool,
  spriteTableCost,
} from '@tinyforge/editor-core';
import type { IDockviewPanelProps } from 'dockview-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../EditorContext.ts';
import { useStore } from '../hooks.ts';

export interface SpritePanelParams {
  path: string;
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

const TOOLS: Array<{ tool: SpriteTool; label: string; key: string; icon: string }> = [
  { tool: 'pencil', label: 'Pencil', key: 'B', icon: '✎' },
  { tool: 'eraser', label: 'Eraser', key: 'E', icon: '⌫' },
  { tool: 'fill', label: 'Fill', key: 'G', icon: '▧' },
  { tool: 'line', label: 'Line', key: 'L', icon: '╱' },
  { tool: 'rect', label: 'Rectangle', key: 'R', icon: '▭' },
  { tool: 'picker', label: 'Pick colour', key: 'I', icon: '⊙' },
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

export function SpritePanel({ api, params }: IDockviewPanelProps<SpritePanelParams>) {
  const editor = useEditor();
  // The path the panel opened; a save may rename the file, the model follows it.
  const [initial] = useState(params.path);
  // Stable, so the view's title effect runs only when the title or path changes.
  const setTitle = useCallback(
    (title: string, path: string) => {
      api.setTitle(title);
      api.updateParameters({ path });
    },
    [api],
  );
  const [sprite, setSprite] = useState<SpriteEditor | null>(null);

  useEffect(() => {
    const created = new SpriteEditor(initial, {
      files: editor.files,
      commands: editor.commands,
      decodeImage: browserDecodeImage,
    });
    void created.load();
    setSprite(created);
    if (import.meta.env.DEV) editor.openSprites.add(created);
    return () => {
      editor.openSprites.delete(created);
      created.dispose();
    };
  }, [editor, initial]);

  return sprite ? <SpriteEditorView sprite={sprite} setTitle={setTitle} /> : null;
}

function SpriteEditorView({
  sprite,
  setTitle,
}: {
  sprite: SpriteEditor;
  setTitle: (title: string, path: string) => void;
}) {
  const editor = useEditor();
  const s = useStore(sprite.state);
  const canvasRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const writable = useStore(editor.files.state).writable;
  const [size, setSize] = useState({ w: '', h: '' });
  const name = baseName(s.path);

  useEffect(() => setTitle(s.dirty ? `● ${name}` : name, s.path), [s.dirty, name, s.path, setTitle]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const view = new SpriteCanvas(el, sprite);
    return () => view.dispose();
  }, [sprite]);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const preview = new FramePreview(el, sprite, 64);
    return () => preview.dispose();
  }, [sprite]);

  useEffect(() => setSize({ w: String(s.frameWidth), h: String(s.frameHeight) }), [s.frameWidth, s.frameHeight]);

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && key === 's') {
      e.preventDefault();
      if (writable) void sprite.save();
      return;
    }
    if (ctrl && (key === 'z' || key === 'y')) {
      e.preventDefault();
      const redo = key === 'y' || e.shiftKey;
      // Nothing left to undo here: undo the last file edit (a save, say) instead.
      if (!(redo ? sprite.redo() : sprite.undo())) editor.runShortcut(redo ? 'redo' : 'undo');
      return;
    }
    if (ctrl || e.altKey) return;
    const tool = TOOLS.find((t) => t.key.toLowerCase() === key);
    if (tool) sprite.setTool(tool.tool);
    else if (key === '[') sprite.setFrame(s.frame - 1);
    else if (key === ']') sprite.setFrame(s.frame + 1);
    else if (key === '+' || key === '=') sprite.setZoom(s.zoom + 1);
    else if (key === '-') sprite.setZoom(s.zoom - 1);
    else return;
    e.preventDefault();
  };

  const [r, g, b, a] = rgbaOf(s.color);
  const tableBytes = spriteTableCost({ width: s.frameWidth * s.cols, height: s.frameHeight * s.rows }, s.cols, s.rows);
  const sizeValid = (v: string) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= MAX_FRAME_SIDE;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard shortcuts for the editor inside; every action also has a button
    <div
      className="tf-sprite"
      data-testid={`sprite-${s.path}`}
      data-local-history="true"
      tabIndex={-1}
      onKeyDown={onKey}
    >
      <div className="tf-sprite-bar">
        <div className="tf-sprite-group">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              type="button"
              className={s.tool === t.tool ? 'tf-sprite-tool tf-sprite-on' : 'tf-sprite-tool'}
              title={`${t.label} (${t.key})`}
              aria-label={t.label}
              aria-pressed={s.tool === t.tool}
              data-testid={`sprite-tool-${t.tool}`}
              onClick={() => sprite.setTool(t.tool)}
            >
              {t.icon}
            </button>
          ))}
        </div>
        <div className="tf-sprite-group">
          <button type="button" title="Zoom out (-)" onClick={() => sprite.setZoom(s.zoom - 1)}>
            −
          </button>
          <span className="tf-sprite-zoom">{s.zoom}×</span>
          <button type="button" title="Zoom in (+)" onClick={() => sprite.setZoom(s.zoom + 1)}>
            +
          </button>
          <button
            type="button"
            className={s.grid ? 'tf-sprite-on' : ''}
            aria-pressed={s.grid}
            onClick={() => sprite.toggle('grid')}
          >
            Grid
          </button>
          <button
            type="button"
            className={s.onion ? 'tf-sprite-on' : ''}
            aria-pressed={s.onion}
            title="Show the previous frame faintly"
            onClick={() => sprite.toggle('onion')}
          >
            Onion skin
          </button>
        </div>
        <div className="tf-sprite-group">
          <button type="button" title="Mirror left to right" onClick={() => sprite.flipFrame('x')}>
            ⇋
          </button>
          <button type="button" title="Mirror top to bottom" onClick={() => sprite.flipFrame('y')}>
            ⥮
          </button>
          <button type="button" title="Clear the frame" onClick={() => sprite.clearFrame()}>
            Clear
          </button>
        </div>
        <div className="tf-sprite-group tf-sprite-right">
          <button type="button" disabled={!s.canUndo} title="Undo (Ctrl+Z)" onClick={() => sprite.undo()}>
            Undo
          </button>
          <button type="button" disabled={!s.canRedo} title="Redo (Ctrl+Shift+Z)" onClick={() => sprite.redo()}>
            Redo
          </button>
          {writable ? (
            <button
              type="button"
              className="tf-sprite-save"
              data-testid="sprite-save"
              disabled={!s.dirty || s.saving}
              title="Save (Ctrl+S)"
              onClick={() => void sprite.save()}
            >
              Save
            </button>
          ) : null}
        </div>
      </div>
      {s.error ? (
        <div className="tf-code-bar tf-code-error" role="alert">
          {s.error}
        </div>
      ) : null}
      {s.conflict ? (
        <div className="tf-code-bar tf-code-conflict" data-testid="sprite-conflict">
          {s.conflict === 'changed'
            ? `${name} changed on disk while you were editing it.`
            : `${name} was deleted on disk. Save to create it again.`}
          {s.conflict === 'changed' ? (
            <button type="button" onClick={() => void sprite.reloadFromDisk()}>
              Use the file on disk
            </button>
          ) : null}
          <button type="button" onClick={() => sprite.keepMine()}>
            Keep my version
          </button>
        </div>
      ) : null}
      <div className="tf-sprite-body">
        <Palette sprite={sprite} color={s.color} used={s.used} />
        <div className="tf-sprite-stage" ref={canvasRef} />
      </div>
      <div className="tf-sprite-frames">
        <div className="tf-sprite-preview">
          <canvas ref={previewRef} />
          <div className="tf-sprite-group">
            <button
              type="button"
              className={s.playing ? 'tf-sprite-on' : ''}
              aria-pressed={s.playing}
              disabled={sprite.frames.length < 2}
              data-testid="sprite-play"
              onClick={() => sprite.toggle('playing')}
            >
              {s.playing ? '■' : '▶'}
            </button>
            <label className="tf-sprite-fps">
              <input
                type="number"
                min={1}
                max={60}
                className="tf-sprite-fps-input"
                value={s.fps}
                onChange={(e) => sprite.setFps(Number(e.target.value) || 1)}
              />
              fps
            </label>
          </div>
        </div>
        <div className="tf-sprite-strip" data-testid="sprite-frames">
          {sprite.frames.map((frame, i) => (
            <FrameThumb
              // biome-ignore lint/suspicious/noArrayIndexKey: frames are positions in the sheet
              key={i}
              index={i}
              frame={frame}
              width={s.frameWidth}
              height={s.frameHeight}
              version={s.version}
              active={i === s.frame}
              onSelect={() => sprite.setFrame(i)}
            />
          ))}
        </div>
        <div className="tf-sprite-frame-tools">
          <div className="tf-sprite-group">
            <button
              type="button"
              title="Add an empty frame"
              data-testid="sprite-add-frame"
              onClick={() => sprite.addFrame()}
            >
              + Frame
            </button>
            <button type="button" title="Copy this frame" onClick={() => sprite.duplicateFrame()}>
              Duplicate
            </button>
            <button type="button" disabled={sprite.frames.length < 2} onClick={() => sprite.deleteFrame()}>
              Delete
            </button>
            <button type="button" title="Move left" disabled={s.frame === 0} onClick={() => sprite.moveFrame(-1)}>
              ◀
            </button>
            <button
              type="button"
              title="Move right"
              disabled={s.frame >= sprite.frames.length - 1}
              onClick={() => sprite.moveFrame(1)}
            >
              ▶
            </button>
          </div>
          <form
            className="tf-sprite-group"
            onSubmit={(e) => {
              e.preventDefault();
              if (sizeValid(size.w) && sizeValid(size.h)) sprite.resize(Number(size.w), Number(size.h));
            }}
          >
            <input
              className="tf-sprite-size"
              aria-label="Frame width"
              value={size.w}
              onChange={(e) => setSize({ ...size, w: e.target.value })}
            />
            ×
            <input
              className="tf-sprite-size"
              aria-label="Frame height"
              value={size.h}
              onChange={(e) => setSize({ ...size, h: e.target.value })}
            />
            <button
              type="submit"
              disabled={
                !sizeValid(size.w) ||
                !sizeValid(size.h) ||
                (Number(size.w) === s.frameWidth && Number(size.h) === s.frameHeight)
              }
            >
              Resize
            </button>
          </form>
        </div>
      </div>
      <div className="tf-sprite-status" data-testid="sprite-status">
        <span>
          {s.cursor ? `${s.cursor.x}, ${s.cursor.y}` : '–'} · frame {s.frame + 1}/{sprite.frames.length} ·{' '}
          {s.frameWidth}×{s.frameHeight}
          {s.cols > 1 || s.rows > 1 ? ` · sheet ${s.cols}×${s.rows}` : ''}
        </span>
        <span title="Bytes this sprite adds to a game's sprite table">{formatBytes(tableBytes)} of sprite memory</span>
        <span className="tf-sprite-swatch-text">
          {hexOf(s.color)} α{a}
          <span className="tf-sprite-swatch" style={{ background: `rgba(${r}, ${g}, ${b}, ${a / 255})` }} />
        </span>
      </div>
    </div>
  );
}

function FrameThumb({
  index,
  frame,
  width,
  height,
  version,
  active,
  onSelect,
}: {
  index: number;
  frame: Uint8ClampedArray;
  width: number;
  height: number;
  version: number;
  active: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version changes when the frame's pixels do
  useEffect(() => {
    if (ref.current) paintFrame(ref.current, frame, width, height);
  }, [frame, width, height, version]);
  return (
    <button
      type="button"
      className={active ? 'tf-sprite-thumb tf-sprite-thumb-on' : 'tf-sprite-thumb'}
      title={`Frame ${index + 1}`}
      data-testid={`sprite-frame-${index}`}
      onClick={onSelect}
    >
      <canvas ref={ref} />
      <span>{index + 1}</span>
    </button>
  );
}

function Palette({ sprite, color, used }: { sprite: SpriteEditor; color: Color; used: Color[] }) {
  const [r, g, b, a] = rgbaOf(color);
  const swatch = (c: Color, i: number, group: string) => (
    <button
      key={`${group}-${i}`}
      type="button"
      className={c === color ? 'tf-sprite-swatch-btn tf-sprite-on' : 'tf-sprite-swatch-btn'}
      title={`${hexOf(c)}${(c & 255) < 255 ? ` α${c & 255}` : ''}`}
      aria-label={`Colour ${hexOf(c)}`}
      onClick={() => sprite.setColor(c)}
    >
      <span style={{ background: cssOf(c) }} />
    </button>
  );
  return (
    <div className="tf-sprite-palette">
      <label className="tf-sprite-current" title="Current colour">
        <input
          type="color"
          className="tf-sprite-color"
          value={hexOf(color)}
          data-testid="sprite-color"
          onChange={(e) => {
            const v = Number.parseInt(e.target.value.slice(1), 16);
            sprite.setColor(colorOf((v >> 16) & 255, (v >> 8) & 255, v & 255, a || 255));
          }}
        />
      </label>
      <label className="tf-sprite-alpha" title="Opacity">
        α
        <input
          type="range"
          className="tf-sprite-alpha-range"
          min={0}
          max={255}
          value={a}
          onChange={(e) => sprite.setColor(colorOf(r, g, b, Number(e.target.value)))}
        />
      </label>
      {used.length > 0 ? (
        <>
          <div className="tf-sprite-palette-title">In this sprite</div>
          <div className="tf-sprite-swatches">{used.map((c, i) => swatch(c, i, 'used'))}</div>
        </>
      ) : null}
      <div className="tf-sprite-palette-title">Palette</div>
      <div className="tf-sprite-swatches">{DEFAULT_PALETTE.map((c, i) => swatch(c, i, 'default'))}</div>
    </div>
  );
}
