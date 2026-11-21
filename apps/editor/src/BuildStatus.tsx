import { useEditor } from './EditorContext.ts';
import { useStore } from './hooks.ts';

const LABELS = { queued: 'queued', building: 'compiling…', failed: 'failed' } as const;

/** A game's compile status, when it is not a finished, good build. */
export function BuildStatus({ game }: { game: string }) {
  const status = useStore(useEditor().compiler.builds)[game]?.status;
  if (!status || status === 'ok') return null;
  return (
    <span className={`tf-build tf-build-${status}`} data-testid={`build-${game}`} data-status={status}>
      {LABELS[status]}
    </span>
  );
}
