import { ProjectFiles } from '@tinyforge/editor-core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { Editor } from './editor.ts';
import { chooseWorkspace } from './workspace.ts';
import 'dockview-react/dist/styles/dockview.css';
import './styles.css';

declare global {
  interface Window {
    /** Dev-only hook for tests and agents: set up state without clicking. */
    __tf?: {
      editor: Editor;
      files: ProjectFiles;
      project: Editor['project'];
      session: Editor['host']['session'];
      run: (fn: (editor: Editor) => void) => void;
      snapshot: () => Promise<Uint8Array>;
    };
  }
}

async function boot(): Promise<void> {
  // The project's files: served by the dev server (or a static copy of them),
  // or the web branch on GitHub in the deployed editor.
  const files = new ProjectFiles(await chooseWorkspace(document.baseURI));
  await files.start();
  const editor = new Editor(files);

  if (import.meta.env.DEV) {
    window.__tf = {
      editor,
      files,
      project: editor.project,
      session: editor.host.session,
      run: (fn) => fn(editor),
      snapshot: () => editor.host.snapshot(),
    };
  }

  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root');
  createRoot(root).render(
    <StrictMode>
      <App editor={editor} />
    </StrictMode>,
  );
  await editor.start();
}

boot().catch((e) => {
  console.error(e);
  document.body.textContent = `TinyForge editor failed to start: ${e instanceof Error ? e.message : String(e)}`;
});
