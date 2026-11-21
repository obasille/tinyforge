import { describe, expect, it } from 'vitest';
import { AssetLibrary } from '../src/asset-library.ts';
import { CommandStack } from '../src/commands.ts';
import { decodePng, encodePng } from '../src/png.ts';
import { ProjectFiles } from '../src/project-files.ts';
import { SoundEditor, type SoundOutput } from '../src/sound-editor.ts';
import {
  floodFill,
  joinFrames,
  layoutFor,
  linePoints,
  newSpriteCommand,
  rectPoints,
  SpriteEditor,
  splitFrames,
  spriteFileName,
} from '../src/sprite-editor.ts';
import { createStore } from '../src/store.ts';
import { decodeWav, encodeWav } from '../src/wav.ts';
import { MemoryWorkspace } from './memory-workspace.ts';

const settle = () => new Promise((r) => setTimeout(r, 0));
const RED = 0xff0000ff;

/** A w×h sheet where frame i is filled with grey level i+1. */
async function sheetPng(fw: number, fh: number, cols: number, rows = 1): Promise<Uint8Array> {
  const frames = Array.from({ length: cols * rows }, (_, i) => new Uint8ClampedArray(fw * fh * 4).fill(i + 1));
  return encodePng(joinFrames(frames, fw, fh, cols, rows));
}

async function setup(files: Record<string, string | Uint8Array>) {
  const ws = new MemoryWorkspace(files);
  const project = new ProjectFiles(ws);
  await project.start();
  const stack = new CommandStack(createStore({}));
  return { ws, files: project, stack };
}

describe('sprite helpers', () => {
  it('splits and joins sheets', () => {
    const image = { width: 4, height: 2, rgba: new Uint8ClampedArray(32).map((_, i) => i) };
    const frames = splitFrames(image, 2, 1);
    expect([...frames[1].slice(0, 4)]).toEqual([8, 9, 10, 11]);
    expect(joinFrames(frames, 2, 2, 2, 1).rgba).toEqual(image.rgba);
  });

  it('names files and lays out frames', () => {
    expect(spriteFileName('coin~8x1-v2.png', 9, 1)).toBe('coin~9x1-v2.png');
    expect(spriteFileName('flag-big.jpg', 1, 1)).toBe('flag-big.png');
    expect(spriteFileName('heart.png', 2, 1)).toBe('heart~2x1.png');
    expect(layoutFor(5, 4, 1)).toEqual({ cols: 5, rows: 1 });
    expect(layoutFor(3, 1, 4)).toEqual({ cols: 1, rows: 3 });
    expect(layoutFor(7, 3, 2)).toEqual({ cols: 3, rows: 3 });
  });

  it('draws lines, rectangles and fills', () => {
    expect(linePoints(0, 0, 3, 1)).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
    ]);
    expect(rectPoints(2, 2, 0, 0)).toHaveLength(8);
    const px = new Uint8ClampedArray(3 * 3 * 4);
    px.set([9, 9, 9, 255], (1 * 3 + 1) * 4); // a wall in the middle
    expect(floodFill(px, 3, 3, 0, 0, RED)).toBe(true);
    expect(px[(1 * 3 + 1) * 4]).toBe(9);
    expect(px[(2 * 3 + 2) * 4]).toBe(255);
    expect(floodFill(px, 3, 3, 0, 0, RED)).toBe(false);
  });
});

describe('SpriteEditor', () => {
  it('draws with undo, then saves a PNG as one undoable command', async () => {
    const { ws, files, stack } = await setup({ 'assets/sprites/dot.png': await sheetPng(4, 4, 1) });
    const sprite = new SpriteEditor('assets/sprites/dot.png', { files, commands: stack });
    await sprite.load();
    expect(sprite.state.getState()).toMatchObject({ ready: true, frameWidth: 4, frameHeight: 4, cols: 1 });
    sprite.setColor(RED);
    sprite.setTool('line');
    sprite.pointerDown(0, 0);
    sprite.pointerMove(3, 0);
    sprite.pointerMove(0, 3); // the line follows the pointer
    sprite.pointerUp();
    expect(sprite.colorAt(3, 0)).not.toBe(RED);
    expect(sprite.colorAt(0, 3)).toBe(RED);
    expect(sprite.state.getState()).toMatchObject({ dirty: true, canUndo: true });
    expect(sprite.state.getState().used).toContain(RED);
    sprite.undo();
    expect(sprite.colorAt(0, 3)).not.toBe(RED);
    sprite.redo();
    // Right button erases; the picker picks.
    sprite.setTool('pencil');
    sprite.pointerDown(0, 0, 2);
    sprite.pointerUp();
    expect(sprite.colorAt(0, 0)).toBe(0);
    sprite.setTool('picker');
    sprite.pointerDown(0, 1);
    expect(sprite.state.getState().color).toBe(RED);

    await sprite.save();
    await settle();
    expect(sprite.state.getState().dirty).toBe(false);
    const saved = await decodePng(ws.data.get('assets/sprites/dot.png') as Uint8Array);
    expect(saved?.rgba.slice((3 * 4 + 0) * 4, (3 * 4 + 0) * 4 + 4)).toEqual(new Uint8ClampedArray([255, 0, 0, 255]));
    expect(stack.getState().undoLabel).toBe('Edit dot.png');
    sprite.dispose();
  });

  it('adds frames and renames the file with its sidecar', async () => {
    const { ws, files, stack } = await setup({
      'assets/sprites/walk~2x1.png': await sheetPng(2, 2, 2),
      'assets/sprites/walk~2x1.png.json': '{"tags":["hero"]}',
    });
    const sprite = new SpriteEditor('assets/sprites/walk~2x1.png', { files, commands: stack });
    await sprite.load();
    expect(sprite.frames).toHaveLength(2);
    sprite.duplicateFrame();
    expect(sprite.state.getState()).toMatchObject({ cols: 3, rows: 1, frame: 1 });
    expect(sprite.frames[1][0]).toBe(1);
    sprite.moveFrame(1);
    expect(sprite.frames.map((f) => f[0])).toEqual([1, 2, 1]);
    sprite.addFrame();
    sprite.deleteFrame();
    expect(sprite.frames).toHaveLength(3);
    await sprite.save();
    await settle();
    expect(sprite.path).toBe('assets/sprites/walk~3x1.png');
    expect(ws.data.has('assets/sprites/walk~2x1.png')).toBe(false);
    expect(ws.text('assets/sprites/walk~3x1.png.json')).toContain('hero');
    // One undo puts the old file and its sidecar back.
    stack.undo();
    await stack.idle();
    await settle();
    expect(ws.data.has('assets/sprites/walk~2x1.png')).toBe(true);
    expect(ws.data.has('assets/sprites/walk~3x1.png')).toBe(false);
    expect(ws.text('assets/sprites/walk~2x1.png.json')).toContain('hero');
    sprite.dispose();
  });

  it('resizes frames and follows changes on disk', async () => {
    const { ws, files, stack } = await setup({ 'assets/sprites/box.png': await sheetPng(2, 2, 1) });
    const sprite = new SpriteEditor('assets/sprites/box.png', { files, commands: stack });
    await sprite.load();
    sprite.resize(3, 1);
    expect(sprite.state.getState()).toMatchObject({ frameWidth: 3, frameHeight: 1 });
    expect([...sprite.frames[0]]).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
    expect(() => sprite.resize(0, 2)).toThrow(/1 to 1024/);
    // Edited: a change on disk is a conflict.
    ws.external('assets/sprites/box.png', await sheetPng(5, 5, 1));
    await settle();
    await settle();
    expect(sprite.state.getState().conflict).toBe('changed');
    await sprite.reloadFromDisk();
    expect(sprite.state.getState()).toMatchObject({ frameWidth: 5, dirty: false, conflict: null });
    // Clean: it reloads.
    ws.external('assets/sprites/box.png', await sheetPng(6, 6, 1));
    await settle();
    await settle();
    expect(sprite.state.getState().frameWidth).toBe(6);
    sprite.dispose();
  });

  it('creates blank sprites', async () => {
    const { ws, files, stack } = await setup({});
    const { path, command } = await newSpriteCommand(files, 'gem', 8, 4, 3);
    await stack.runFile(command);
    expect(path).toBe('assets/sprites/gem~3x1.png');
    const png = await decodePng(ws.data.get(path) as Uint8Array);
    expect(png).toMatchObject({ width: 24, height: 4 });
    await expect(newSpriteCommand(files, 'x', 0, 4)).rejects.toThrow(/1 to 1024/);
  });
});

describe('SoundEditor', () => {
  const tone = () => ({
    sampleRate: 1000,
    channels: [Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 10) * 0.5)],
  });

  it('trims, cuts and fades with undo, and saves a WAV', async () => {
    const { ws, files, stack } = await setup({ 'assets/sfx/beep.wav': encodeWav(tone()) });
    const played: Array<[number, number]> = [];
    const output: SoundOutput = { play: (_s, a, b) => played.push([a, b]), stop: () => {}, position: () => null };
    const sound = new SoundEditor('assets/sfx/beep.wav', { files, commands: stack, output });
    await sound.load();
    expect(sound.state.getState()).toMatchObject({ ready: true, length: 1000, sampleRate: 1000 });
    sound.select(600, 100);
    expect(sound.state.getState().selection).toEqual({ from: 100, to: 600 });
    sound.play();
    expect(played).toEqual([[100, 600]]);
    sound.trim();
    expect(sound.state.getState()).toMatchObject({ length: 500, selection: null, dirty: true });
    sound.select(0, 100);
    sound.cut();
    expect(sound.state.getState().length).toBe(400);
    sound.undo();
    expect(sound.state.getState().length).toBe(500);
    sound.fade('out');
    expect(sound.sound.channels[0][499]).toBeCloseTo(0, 2);
    sound.normalize();
    await sound.save();
    await settle();
    const saved = decodeWav(ws.data.get('assets/sfx/beep.wav') as Uint8Array);
    expect(saved?.channels[0]).toHaveLength(500);
    expect(stack.getState().undoLabel).toBe('Edit beep.wav');
    sound.dispose();
  });

  it('saves another format as a WAV with its sidecar', async () => {
    const { ws, files, stack } = await setup({
      'assets/music/song.ogg': new Uint8Array([1, 2, 3]),
      'assets/music/song.ogg.json': '{"license":"CC0"}',
    });
    const sound = new SoundEditor('assets/music/song.ogg', {
      files,
      commands: stack,
      decodeAudio: async () => tone(),
    });
    await sound.load();
    sound.selectAll();
    sound.fade('in');
    await sound.save();
    await settle();
    expect(sound.path).toBe('assets/music/song.wav');
    expect(ws.data.has('assets/music/song.ogg')).toBe(false);
    expect(ws.text('assets/music/song.wav.json')).toContain('CC0');
    sound.dispose();
  });
});

describe('sprite budget', () => {
  it('counts the sprite table of each game', async () => {
    const ws = new MemoryWorkspace({
      'games/a/main.ts': 'export function draw(): void { s("walk"); s("dot"); s("ghost"); }',
      'games/b/main.ts': 'export function draw(): void {}',
      'assets/sprites/walk~2x1.png': await sheetPng(4, 4, 2),
      'assets/sprites/dot.png': await sheetPng(1, 1, 1),
    });
    const files = new ProjectFiles(ws);
    await files.start();
    const library = new AssetLibrary(files);
    await library.start();
    const { budgets, assets } = library.state.getState();
    // 16-byte header, 48 bytes of entries per sprite, 4 bytes per pixel.
    expect(assets.find((a) => a.id === 'walk')).toMatchObject({ image: { width: 8, height: 4 }, tableBytes: 48 + 128 });
    expect(budgets.a).toEqual({ sprites: 2, bytes: 16 + 48 + 128 + 48 + 4, missing: ['ghost'] });
    expect(budgets.b).toEqual({ sprites: 0, bytes: 0, missing: [] });
    library.setLiveUses('b', { sprites: ['dot'], sfx: [], music: [] });
    expect(library.state.getState().budgets.b.sprites).toBe(1);
  });
});
