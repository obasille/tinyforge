// The project: plain, JSON-serializable data owned by the store, changed only
// through commands. It is small today (which game, run settings) and grows as
// the editor gains editing features.

import type { Command } from './commands.ts';

export interface ProjectState {
  version: 1;
  /** Cartridge name (a file in packages/engine/assembly/games). */
  game: string | null;
  /** Fixed RNG seed for reproducible runs, or null for a random seed per run. */
  seed: number | null;
}

export const emptyProject = (): ProjectState => ({ version: 1, game: null, seed: null });

function setField<K extends keyof ProjectState>(
  type: string,
  label: string,
  key: K,
  value: ProjectState[K],
): (state: ProjectState) => Command<ProjectState> {
  return (state) => {
    const previous = state[key];
    return {
      type,
      label,
      args: { value },
      apply: (s) => ({ ...s, [key]: value }),
      revert: (s) => ({ ...s, [key]: previous }),
    };
  };
}

export const projectCommands = {
  setGame: (state: ProjectState, game: string | null) =>
    setField('project.setGame', 'Select game', 'game', game)(state),
  setSeed: (state: ProjectState, seed: number | null) =>
    setField('project.setSeed', 'Set seed', 'seed', seed === null ? null : (seed >>> 0) & 0x7fffffff)(state),
};

/** Rebuild commands from a recorded log entry, for replay. */
export function commandFromLog(
  state: ProjectState,
  entry: { type: string; args: unknown },
): Command<ProjectState> | null {
  const value = (entry.args as { value?: unknown } | null)?.value;
  switch (entry.type) {
    case 'project.setGame':
      return projectCommands.setGame(state, (value as string | null) ?? null);
    case 'project.setSeed':
      return projectCommands.setSeed(state, (value as number | null) ?? null);
    default:
      return null;
  }
}

/** Replay a recorded command log onto a stack (bug reproduction, tests). */
export function replayProjectLog(
  stack: { run(c: Command<ProjectState>): void; undo(): boolean; redo(): boolean },
  getState: () => ProjectState,
  log: ReadonlyArray<{ type: string; args: unknown }>,
): void {
  for (const entry of log) {
    if (entry.type === 'undo') stack.undo();
    else if (entry.type === 'redo') stack.redo();
    else {
      const command = commandFromLog(getState(), entry);
      if (!command) throw new Error(`Unknown command in log: ${entry.type}`);
      stack.run(command);
    }
  }
}
