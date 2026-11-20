import { useEffect, useRef } from 'react';
import { useEditor } from '../EditorContext.ts';
import { useStore } from '../hooks.ts';

export function ConsolePanel() {
  const editor = useEditor();
  const entries = useStore(editor.logs);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  });

  return (
    <div className="tf-console">
      <div className="tf-console-bar">
        <button type="button" onClick={() => editor.logs.clear()}>
          Clear
        </button>
      </div>
      <div className="tf-console-entries" data-testid="console">
        {entries.map((e) => (
          <div key={e.id} className={`tf-log tf-log-${e.kind.toLowerCase()}`}>
            <span className="tf-log-time">{e.time}</span>
            <span className="tf-log-kind">[{e.kind}]</span> {e.message}
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}
