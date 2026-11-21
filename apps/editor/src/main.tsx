import type { AssetManifest } from '@tinyforge/editor-core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { Editor } from './editor.ts';
import 'dockview-react/dist/styles/dockview.css';
import './styles.css';

declare global {
  interface Window {
    /** Dev-only hook for tests and agents: set up state without clicking. */
    __tf?: {
      editor: Editor;
      project: Editor['project'];
      session: Editor['host']['session'];
      run: (fn: (editor: Editor) => void) => void;
      snapshot: () => Promise<Uint8Array>;
    };
  }
}

async function boot(): Promise<void> {
  const res = await fetch(new URL('__tf/manifest.json', document.baseURI), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load the game manifest (HTTP ${res.status})`);
  const manifest = (await res.json()) as AssetManifest;
  const editor = new Editor(manifest);

  if (import.meta.hot) {
    import.meta.hot.on('tf:cartridges', (data: { games: string[]; failed?: string; log?: string }) => {
      if (data.failed) editor.logs.add('ERROR', `${data.failed} failed to compile:\n${data.log ?? ''}`);
      else editor.hotReload(data.games);
    });
    import.meta.hot.on('tf:assets', () => void editor.reloadAssets());
  }
  if (import.meta.env.DEV) {
    window.__tf = {
      editor,
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
