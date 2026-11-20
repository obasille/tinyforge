import { useSyncExternalStore } from 'react';

interface Subscribable<T> {
  getState(): T;
  subscribe(listener: () => void): () => void;
}

/** Read a plain-TS store from React. */
export function useStore<T>(store: Subscribable<T>): T {
  return useSyncExternalStore(store.subscribe, store.getState);
}
