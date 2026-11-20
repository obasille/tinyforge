import { createStore } from '@tinyforge/editor-core';

export type LogKind = 'LOG' | 'WARN' | 'ERROR' | 'TRACE' | 'ABORT' | 'HOST';

export interface LogEntry {
  id: number;
  time: string;
  kind: LogKind;
  message: string;
}

const MAX_ENTRIES = 1000;

export function createLogStore() {
  const store = createStore<LogEntry[]>([]);
  let nextId = 1;
  return {
    ...store,
    add(kind: LogKind, message: string): void {
      const entry = { id: nextId++, time: new Date().toLocaleTimeString(), kind, message };
      store.setState((entries) => [...entries.slice(-(MAX_ENTRIES - 1)), entry]);
      // Mirror to DevTools; game errors count as console errors for the smoke test.
      const text = `[${kind}] ${message}`;
      if (kind === 'ERROR' || kind === 'ABORT') console.error(text);
      else if (kind === 'WARN') console.warn(text);
      else console.debug(text);
    },
    clear(): void {
      store.setState([]);
    },
  };
}

export type LogStore = ReturnType<typeof createLogStore>;
