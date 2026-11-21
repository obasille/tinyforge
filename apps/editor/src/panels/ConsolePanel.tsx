import { type ReactNode, useEffect, useRef } from 'react';
import { useEditor } from '../EditorContext.ts';
import { useStore } from '../hooks.ts';

/** A project file and place as compiler messages write it: games/pong/main.ts(12,5). */
const PLACE = /\b((?:games|engine)\/[\w./-]+\.ts)\((\d+),(\d+)\)/g;

/** The message, with each file(line,column) a link that opens the code editor there. */
function withLinks(message: string, open: (path: string, line: number, column: number) => void): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of message.matchAll(PLACE)) {
    const [text, path, line, column] = m;
    parts.push(message.slice(last, m.index));
    parts.push(
      <button key={m.index} type="button" className="tf-log-link" onClick={() => open(path, +line, +column)}>
        {text}
      </button>,
    );
    last = m.index + text.length;
  }
  parts.push(message.slice(last));
  return parts;
}

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
            <span className="tf-log-kind">[{e.kind}]</span>{' '}
            {withLinks(e.message, (path, line, column) => editor.workbench.openFile(path, { line, column }))}
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}
