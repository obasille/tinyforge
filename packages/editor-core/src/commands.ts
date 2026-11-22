// Every edit to the project is a command with do/undo. The stack gives
// undo/redo, dirty tracking, and a log that can be replayed in a test.
//
// Two kinds share one history: state commands change the project state
// (apply/revert are pure functions of it), and file commands change files
// through the Workspace (apply/revert are async). Ctrl+Z undoes whichever
// came last. File commands run one at a time, in order.

import type { Store } from './store.ts';

export interface Command<T> {
  /** Stable name, used in the replay log ("project.setGame"). */
  readonly type: string;
  /** Shown in menus ("Undo Select game 'Snake'"): see `commandLabel`. */
  readonly label: string;
  /** JSON-serializable arguments, recorded for replay. */
  readonly args: unknown;
  apply(state: T): T;
  revert(state: T): T;
}

/** A command whose effect is on files. revert() restores the previous bytes. */
export interface FileCommand {
  readonly type: string;
  readonly label: string;
  readonly args: unknown;
  apply(): Promise<void>;
  revert(): Promise<void>;
}

/** A command's label: the action, then its argument in quotes ("Select game 'Snake'"). */
export const commandLabel = (action: string, arg: string): string => `${action} '${arg}'`;

type Entry<T> = { kind: 'state'; command: Command<T> } | { kind: 'file'; command: FileCommand };

export interface CommandStackState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  /** Labels of the most recent changes that can be undone, newest first. */
  history: readonly string[];
  dirty: boolean;
}

/** How many entries `CommandStackState.history` lists at most. */
export const HISTORY_LIMIT = 20;

export class CommandStack<T> {
  private done: Entry<T>[] = [];
  private undone: Entry<T>[] = [];
  private savedAt = 0;
  private readonly listeners = new Set<() => void>();
  private cached: CommandStackState | null = null;
  /** File commands (and undo/redo of them) in progress, in order. */
  private queue: Promise<void> = Promise.resolve();
  /** Every command run, in order, for session export and replay. */
  readonly log: Array<{ type: string; args: unknown }> = [];

  constructor(
    private readonly store: Store<T>,
    /** Called when a file command, its undo or its redo fails. */
    private readonly onError: (message: string) => void = () => {},
  ) {}

  run(command: Command<T>): void {
    this.store.setState(command.apply(this.store.getState()));
    this.push({ kind: 'state', command });
  }

  /** Run a file command; it joins the history once it succeeded. Rejects if it fails. */
  runFile(command: FileCommand): Promise<void> {
    const result = this.queue.then(async () => {
      await command.apply();
      this.push({ kind: 'file', command });
    });
    this.queue = result.catch(() => {});
    return result;
  }

  private push(entry: Entry<T>): void {
    this.done.push(entry);
    this.undone = [];
    this.log.push({ type: entry.command.type, args: entry.command.args });
    this.emit();
  }

  undo(): boolean {
    const entry = this.done.pop();
    if (!entry) return false;
    this.log.push({ type: 'undo', args: null });
    if (entry.kind === 'state') {
      this.store.setState(entry.command.revert(this.store.getState()));
      this.undone.push(entry);
      this.emit();
      return true;
    }
    this.emit();
    this.queue = this.queue.then(async () => {
      try {
        await entry.command.revert();
        this.undone.push(entry);
      } catch (e) {
        this.done.push(entry);
        this.onError(`Could not undo ${entry.command.label}: ${e instanceof Error ? e.message : String(e)}`);
      }
      this.emit();
    });
    return true;
  }

  /** Undo the last `steps` changes, newest first. Returns how many were undone. */
  undoMany(steps: number): number {
    let count = 0;
    while (count < steps && this.undo()) count++;
    return count;
  }

  redo(): boolean {
    const entry = this.undone.pop();
    if (!entry) return false;
    this.log.push({ type: 'redo', args: null });
    if (entry.kind === 'state') {
      this.store.setState(entry.command.apply(this.store.getState()));
      this.done.push(entry);
      this.emit();
      return true;
    }
    this.emit();
    this.queue = this.queue.then(async () => {
      try {
        await entry.command.apply();
        this.done.push(entry);
      } catch (e) {
        this.undone.push(entry);
        this.onError(`Could not redo ${entry.command.label}: ${e instanceof Error ? e.message : String(e)}`);
      }
      this.emit();
    });
    return true;
  }

  /** Resolves when every queued file command, undo and redo has finished. */
  idle(): Promise<void> {
    return this.queue;
  }

  /** Mark the current state as saved (clears dirty). */
  markSaved(): void {
    this.savedAt = this.done.length;
    this.emit();
  }

  /** Current undo/redo summary; the same object until the stack changes. */
  get state(): CommandStackState {
    this.cached ??= this.compute();
    return this.cached;
  }

  /** Store-shaped access, for useSyncExternalStore. */
  getState = (): CommandStackState => this.state;

  private compute(): CommandStackState {
    const last = this.done.at(-1);
    const next = this.undone.at(-1);
    return {
      canUndo: this.done.length > 0,
      canRedo: this.undone.length > 0,
      undoLabel: last?.command.label ?? null,
      redoLabel: next?.command.label ?? null,
      history: this.done
        .slice(-HISTORY_LIMIT)
        .reverse()
        .map((e) => e.command.label),
      // A redo can bring the stack back to the saved point.
      dirty: this.done.length !== this.savedAt,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    this.cached = null;
    for (const listener of [...this.listeners]) listener();
  }
}
