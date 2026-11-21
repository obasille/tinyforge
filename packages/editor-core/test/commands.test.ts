import { describe, expect, it } from 'vitest';
import { CommandStack } from '../src/commands.ts';
import { emptyProject, type ProjectState, projectCommands, replayProjectLog } from '../src/project.ts';
import { createStore } from '../src/store.ts';

function setup() {
  const store = createStore<ProjectState>(emptyProject());
  const stack = new CommandStack(store);
  const run = (make: (s: ProjectState) => ReturnType<typeof projectCommands.setGame>) =>
    stack.run(make(store.getState()));
  return { store, stack, run };
}

describe('CommandStack', () => {
  it('applies, undoes and redoes commands', () => {
    const { store, stack, run } = setup();
    run((s) => projectCommands.setGame(s, 'pong'));
    run((s) => projectCommands.setGame(s, 'snake'));
    expect(store.getState().game).toBe('snake');
    stack.undo();
    expect(store.getState().game).toBe('pong');
    stack.undo();
    expect(store.getState().game).toBeNull();
    expect(stack.undo()).toBe(false);
    stack.redo();
    expect(store.getState().game).toBe('pong');
  });

  it('drops the redo branch when a new command runs', () => {
    const { store, stack, run } = setup();
    run((s) => projectCommands.setGame(s, 'pong'));
    stack.undo();
    run((s) => projectCommands.setSeed(s, 42));
    expect(stack.state.canRedo).toBe(false);
    expect(store.getState()).toEqual({ version: 1, game: null, seed: 42 });
  });

  it('tracks dirty state against the saved point', () => {
    const { stack, run } = setup();
    expect(stack.state.dirty).toBe(false);
    run((s) => projectCommands.setGame(s, 'pong'));
    expect(stack.state.dirty).toBe(true);
    stack.markSaved();
    expect(stack.state.dirty).toBe(false);
    stack.undo();
    expect(stack.state.dirty).toBe(true);
    stack.redo();
    expect(stack.state.dirty).toBe(false);
  });

  it('labels the next undo and redo', () => {
    const { stack, run } = setup();
    run((s) => projectCommands.setSeed(s, 7));
    expect(stack.state.undoLabel).toBe('Set seed');
    stack.undo();
    expect(stack.state.redoLabel).toBe('Set seed');
  });

  it('lists recent history and undoes back to an entry', () => {
    const { store, stack, run } = setup();
    run((s) => projectCommands.setGame(s, 'pong'));
    run((s) => projectCommands.setSeed(s, 7));
    run((s) => projectCommands.setGame(s, 'snake'));
    expect(stack.state.history).toEqual(['Select game', 'Set seed', 'Select game']);
    expect(stack.undoMany(2)).toBe(2);
    expect(store.getState()).toEqual({ version: 1, game: 'pong', seed: null });
    expect(stack.state.history).toEqual(['Select game']);
    expect(stack.undoMany(5)).toBe(1);
    expect(stack.state.history).toEqual([]);
  });

  it('keeps seeds in the SDK range', () => {
    const { store, run } = setup();
    run((s) => projectCommands.setSeed(s, -1));
    expect(store.getState().seed).toBe(0x7fffffff);
  });

  it('replays a recorded session to the same state', () => {
    const a = setup();
    a.run((s) => projectCommands.setGame(s, 'pong'));
    a.run((s) => projectCommands.setSeed(s, 99));
    a.stack.undo();
    a.run((s) => projectCommands.setGame(s, 'tetris'));
    a.stack.undo();
    a.stack.redo();
    const log = JSON.parse(JSON.stringify(a.stack.log));

    const b = setup();
    replayProjectLog(b.stack, b.store.getState, log);
    expect(b.store.getState()).toEqual(a.store.getState());
  });

  it('notifies store subscribers only on change', () => {
    const store = createStore(1);
    let calls = 0;
    store.subscribe(() => calls++);
    store.setState(1);
    store.setState((n) => n + 1);
    expect(calls).toBe(1);
  });
});
