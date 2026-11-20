// Every edit to the project is a command with do/undo. The stack gives
// undo/redo, dirty tracking, and a log that can be replayed in a test.

import type { Store } from './store.ts';

export interface Command<T> {
  /** Stable name, used in the replay log ("project.setGame"). */
  readonly type: string;
  /** Shown in menus ("Undo Select game"). */
  readonly label: string;
  /** JSON-serializable arguments, recorded for replay. */
  readonly args: unknown;
  apply(state: T): T;
  revert(state: T): T;
}

export interface CommandStackState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  dirty: boolean;
}

export class CommandStack<T> {
  private done: Command<T>[] = [];
  private undone: Command<T>[] = [];
  private savedAt = 0;
  private readonly listeners = new Set<() => void>();
  private cached: CommandStackState | null = null;
  /** Every command run, in order, for session export and replay. */
  readonly log: Array<{ type: string; args: unknown }> = [];

  constructor(private readonly store: Store<T>) {}

  run(command: Command<T>): void {
    this.store.setState(command.apply(this.store.getState()));
    this.done.push(command);
    this.undone = [];
    this.log.push({ type: command.type, args: command.args });
    this.emit();
  }

  undo(): boolean {
    const command = this.done.pop();
    if (!command) return false;
    this.store.setState(command.revert(this.store.getState()));
    this.undone.push(command);
    this.log.push({ type: 'undo', args: null });
    this.emit();
    return true;
  }

  redo(): boolean {
    const command = this.undone.pop();
    if (!command) return false;
    this.store.setState(command.apply(this.store.getState()));
    this.done.push(command);
    this.log.push({ type: 'redo', args: null });
    this.emit();
    return true;
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
      undoLabel: last?.label ?? null,
      redoLabel: next?.label ?? null,
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
