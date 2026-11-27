// One open file: mounts a container and hands it to the plain-TS CodeEditor
// (editor-core code-editor.ts). The tab title shows unsaved changes.

import type { CodeEditor } from '@tinyforge/editor-core';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../EditorContext.ts';
import { useStore } from '../hooks.ts';
import type { PanelProps } from './panel-api.ts';

export interface CodePanelParams {
  path: string;
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export function CodePanel({ api, params }: PanelProps<CodePanelParams>) {
  const editor = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState<CodeEditor | null>(null);
  const path = params.path;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const created = editor.workbench.createCodeEditor(path, el);
    setCode(created);
    return () => created.dispose();
  }, [editor, path]);

  return (
    <div className="tf-code" data-testid={`code-${path}`}>
      {code ? <CodeStatus code={code} title={(t) => api.setTitle(t)} name={baseName(path)} /> : null}
      <div className="tf-code-editor" ref={ref} />
    </div>
  );
}

function CodeStatus({ code, title, name }: { code: CodeEditor; title: (t: string) => void; name: string }) {
  const s = useStore(code.state);
  useEffect(() => title(s.dirty ? `● ${name}` : name), [s.dirty, name, title]);
  return (
    <>
      {s.readonly && !s.loading ? <div className="tf-code-bar">Read-only</div> : null}
      {s.error ? (
        <div className="tf-code-bar tf-code-error" role="alert">
          {s.error}
        </div>
      ) : null}
      {s.conflict === 'changed' ? (
        <div className="tf-code-bar tf-code-conflict" data-testid="code-conflict">
          {name} changed on disk while you were editing it.
          <button type="button" onClick={() => void code.reloadFromDisk()}>
            Use the file on disk
          </button>
          <button type="button" onClick={() => code.keepMine()}>
            Keep my version
          </button>
        </div>
      ) : null}
      {s.conflict === 'deleted' ? (
        <div className="tf-code-bar tf-code-conflict" data-testid="code-conflict">
          {name} was deleted on disk. Save (Ctrl+S) to create it again.
          <button type="button" onClick={() => code.keepMine()}>
            OK
          </button>
        </div>
      ) : null}
    </>
  );
}
