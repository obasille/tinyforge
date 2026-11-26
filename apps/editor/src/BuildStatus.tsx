import { useEditor } from './EditorContext.ts';
import { useStore } from './hooks.ts';

/** A game's compile status, when it is not a finished, good build. */
export function BuildStatus({ game }: { game: string }) {
  const build = useStore(useEditor().compiler.builds)[game];
  if (!build || build.status === 'ok') return null;
  let label: string = build.status === 'queued' ? 'queued' : 'compiling…';
  if (build.status === 'failed') {
    // A crashed compile can fail without any error diagnostic.
    const errors = build.diagnostics.filter((d) => d.severity === 'error').length;
    label = errors === 0 ? 'failed' : errors === 1 ? '1 error' : `${errors} errors`;
  }
  return (
    <span className={`tf-build tf-build-${build.status}`} data-testid={`build-${game}`} data-status={build.status}>
      {label}
    </span>
  );
}
