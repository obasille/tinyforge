// The file tree, in three sections: Code (the games' sources), Assets (the
// asset library) and Engine (the read-only engine files). The file of the
// active code tab is highlighted and revealed. Click a text file to open it.
// Create, rename, delete and import are undoable
// (Ctrl+Z outside a text field). Names are typed in place, never in a dialog.
// Export saves the selected (or current) game as a zip; import adds one.
// Cartridge saves it as a release .wasm with the assets it uses embedded.

import {
  buildTree,
  exportCartridge,
  exportGameZip,
  gameImportCommand,
  isTextFile,
  planGameImport,
  type TreeNode,
} from '@tinyforge/editor-core';
import type { ImportPlan } from '@tinyforge/engine/tooling/game-zip';
import { assetKindOf, GAME_NAME, gameOf, isWritablePath } from '@tinyforge/engine/tooling/project-layout';
import { useMemo, useRef, useState } from 'react';
import { AppMenu, type AppMenuItem } from '../AppMenu.tsx';
import { BuildStatus } from '../BuildStatus.tsx';
import { useEditor } from '../EditorContext.ts';
import { useStore } from '../hooks.ts';
import { usesTouchLayout } from '../layout-mode.ts';
import { useRevealFile } from './reveal-file.ts';

type Edit =
  | { kind: 'newGame' }
  | { kind: 'newFile'; folder: string }
  | { kind: 'rename'; node: TreeNode }
  | { kind: 'delete'; node: TreeNode };

const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));

/** The tree's sections, in order: one per top-level folder. */
const SECTIONS: { path: string; label: string }[] = [
  { path: 'games', label: 'Code' },
  { path: 'assets', label: 'Assets' },
  { path: 'engine', label: 'Engine' },
];

/** Folders that hold the project's structure: they cannot be renamed or deleted. */
const isFixedFolder = (node: TreeNode) =>
  node.kind === 'folder' && (!node.path.includes('/') || /^assets\/[^/]+$/.test(node.path));

export function FilesPanel() {
  const editor = useEditor();
  const state = useStore(editor.files.state);
  const tree = useMemo(() => buildTree(state.files), [state.files]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(['games', 'assets']));
  const [selected, setSelected] = useState<string | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const currentGame = useStore(editor.project).game;
  // Export follows the selection, like Delete: a game's folder or any file in it. Nothing
  // selected yet: the current game.
  const selectedGame = selected === null ? currentGame : gameOf(`${selected}/-`);
  const exportTarget = selectedGame && editor.files.games.includes(selectedGame) ? selectedGame : null;
  const activeCode = useStore(editor.activeCode);
  // The active code tab's file: selected, its folders opened, scrolled into view.
  const treeRef = useRevealFile(activeCode, state.files, setSelected, setOpen);

  const selectedNode = useMemo(() => {
    const find = (nodes: TreeNode[]): TreeNode | null => {
      for (const n of nodes) {
        if (n.path === selected) return n;
        const hit = find(n.children);
        if (hit) return hit;
      }
      return null;
    };
    return selected ? find(tree) : null;
  }, [tree, selected]);

  const run = (action: Promise<void>) => {
    setError(null);
    action.then(
      () => setEdit(null),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  };

  const download = (file: Promise<Uint8Array>, name: string, type: string) => {
    setError(null);
    file.then(
      (bytes) => {
        const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  };
  const exportGame = (game: string) =>
    download(
      exportGameZip(editor.files, game, editor.assets.state.getState().assets),
      `${game}.zip`,
      'application/zip',
    );
  const exportGameCartridge = (game: string) =>
    download(
      exportCartridge(editor.files, game, () => editor.compiler.build(game, 'release')),
      `${game}.wasm`,
      'application/wasm',
    );

  const readZip = (file: File) => {
    setError(null);
    setPlan(null);
    file
      .arrayBuffer()
      .then((buf) => planGameImport(editor.files, new Uint8Array(buf)))
      .then(
        (p) => {
          if (p.gameExists) setError(`The project already has a game named ${p.game}. Rename or delete it first.`);
          else if (p.changed.length > 0) setPlan(p);
          else finishImport(p, false);
        },
        (e: unknown) => setError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`),
      );
  };

  const finishImport = (p: ImportPlan, replace: boolean) => {
    setPlan(null);
    run(
      gameImportCommand(editor.files, p, replace)
        .then((command) => editor.commands.runFile(command))
        .then(() => {
          setOpen((s) => new Set([...s, 'games', `games/${p.game}`]));
          editor.workbench.openFile(`games/${p.game}/main.ts`);
        }),
    );
  };

  // Where "New file" puts the file: the selected folder, or the selected file's folder.
  const targetFolder = selectedNode
    ? selectedNode.kind === 'folder'
      ? selectedNode.path
      : parentOf(selectedNode.path)
    : null;
  const canCreateIn = !!targetFolder && isWritablePath(`${targetFolder}/new.ts`);
  const canChange = !!selectedNode && !selectedNode.readonly && !isFixedFolder(selectedNode);

  const toggle = (path: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const commit = (value: string) => {
    if (!edit) return;
    const name = value.trim();
    if (!name) return setEdit(null);
    if (edit.kind === 'newGame') {
      if (!GAME_NAME.test(name)) return setError('A game name uses only letters, digits, _ and -');
      run(editor.workbench.createGame(name));
      setOpen((s) => new Set([...s, 'games', `games/${name}`]));
    } else if (edit.kind === 'newFile') {
      run(editor.workbench.createFile(`${edit.folder}/${name}`));
      setOpen((s) => new Set([...s, edit.folder]));
    } else if (edit.kind === 'rename') {
      const to = `${parentOf(edit.node.path)}/${name}`;
      run(editor.workbench.rename(edit.node.path, to));
      setSelected(to);
    }
  };

  const nameInput = (initial: string, placeholder: string) => (
    <input
      className="tf-files-input"
      data-testid="files-name"
      // biome-ignore lint/a11y/noAutofocus: the input appears because the user asked to type a name
      autoFocus
      defaultValue={initial}
      placeholder={placeholder}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e.currentTarget.value);
        if (e.key === 'Escape') setEdit(null);
        e.stopPropagation();
      }}
      onBlur={(e) => {
        if (!error) commit(e.currentTarget.value);
      }}
    />
  );

  const renderNode = (node: TreeNode, depth: number) => {
    const isOpen = open.has(node.path);
    const renaming = edit?.kind === 'rename' && edit.node.path === node.path;
    return (
      <li key={node.path}>
        {renaming ? (
          <div className="tf-files-row tf-files-selected" style={{ paddingLeft: 6 + depth * 12 }}>
            <span className="tf-files-icon">{node.kind === 'folder' ? '▸' : '·'}</span>
            {nameInput(node.name, node.name)}
          </div>
        ) : (
          <button
            type="button"
            className={`tf-files-row${selected === node.path ? ' tf-files-selected' : ''}${activeCode === node.path ? ' tf-files-active' : ''}${node.readonly ? ' tf-files-readonly' : ''}`}
            style={{ paddingLeft: 6 + depth * 12 }}
            data-testid={`file-${node.path}`}
            title={node.readonly ? `${node.path} (read-only)` : node.path}
            aria-expanded={node.kind === 'folder' ? isOpen : undefined}
            aria-current={activeCode === node.path ? 'true' : undefined}
            onClick={() => {
              setSelected(node.path);
              setError(null);
              if (node.kind === 'folder') toggle(node.path);
              else if (isTextFile(node.path)) editor.workbench.openFile(node.path);
              else if (assetKindOf(node.path)) editor.showAsset(node.path);
            }}
            onKeyDown={(e) => {
              if (e.key === 'F2' && !node.readonly && !isFixedFolder(node)) setEdit({ kind: 'rename', node });
            }}
          >
            <span className="tf-files-icon">{node.kind === 'folder' ? (isOpen ? '▾' : '▸') : '·'}</span>
            <span className="tf-files-name">{node.name}</span>
            {node.readonly && node.kind === 'file' ? <span className="tf-files-lock">read-only</span> : null}
            {/^games\/[^/]+$/.test(node.path) ? <BuildStatus game={node.name} /> : null}
          </button>
        )}
        {node.kind === 'folder' && isOpen ? (
          <ul>
            {edit?.kind === 'newFile' && edit.folder === node.path ? (
              <li>
                <div className="tf-files-row" style={{ paddingLeft: 6 + (depth + 1) * 12 }}>
                  <span className="tf-files-icon">+</span>
                  {nameInput('', 'file name, like level.ts')}
                </div>
              </li>
            ) : null}
            {node.path === 'games' && edit?.kind === 'newGame' ? (
              <li>
                <div className="tf-files-row" style={{ paddingLeft: 6 + (depth + 1) * 12 }}>
                  <span className="tf-files-icon">+</span>
                  {nameInput('', 'game name, like spaceRace')}
                </div>
              </li>
            ) : null}
            {node.children.map((c) => renderNode(c, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  };

  /** A section: a top-level folder shown as a heading, its contents unindented. */
  const renderSection = (node: TreeNode, label: string) => {
    const isOpen = open.has(node.path);
    return (
      <li key={node.path} className="tf-files-section">
        <button
          type="button"
          className={`tf-files-row tf-files-section-head${selected === node.path ? ' tf-files-selected' : ''}`}
          data-testid={`file-${node.path}`}
          title={node.readonly ? `${node.path} (read-only)` : node.path}
          aria-expanded={isOpen}
          onClick={() => {
            setSelected(node.path);
            setError(null);
            toggle(node.path);
          }}
        >
          <span className="tf-files-icon">{isOpen ? '▾' : '▸'}</span>
          <span className="tf-files-name">{label}</span>
          {node.readonly ? <span className="tf-files-lock">read-only</span> : null}
        </button>
        {isOpen ? (
          <ul>
            {node.path === 'games' && edit?.kind === 'newGame' ? (
              <li>
                <div className="tf-files-row" style={{ paddingLeft: 6 }}>
                  <span className="tf-files-icon">+</span>
                  {nameInput('', 'game name, like spaceRace')}
                </div>
              </li>
            ) : null}
            {node.children.map((c) => renderNode(c, 0))}
          </ul>
        ) : null}
      </li>
    );
  };

  const touch = usesTouchLayout(useStore(editor.layoutMode));
  const actions: AppMenuItem[] = [
    {
      label: 'New game',
      disabled: !state.writable,
      onSelect: () => {
        setOpen((s) => new Set([...s, 'games']));
        setEdit({ kind: 'newGame' });
      },
    },
    {
      label: 'New file',
      disabled: !state.writable || !canCreateIn,
      title: canCreateIn ? `New file in ${targetFolder}` : 'Select a folder in games/ or assets/',
      onSelect: () => targetFolder && setEdit({ kind: 'newFile', folder: targetFolder }),
    },
    {
      label: 'Rename',
      disabled: !state.writable || !canChange,
      onSelect: () => selectedNode && setEdit({ kind: 'rename', node: selectedNode }),
    },
    {
      label: 'Delete',
      disabled: !state.writable || !canChange,
      onSelect: () => selectedNode && setEdit({ kind: 'delete', node: selectedNode }),
    },
    {
      label: 'Export',
      testId: 'files-export',
      disabled: !exportTarget,
      title: exportTarget
        ? `Save ${exportTarget} as a zip: its folder and the assets it uses`
        : 'Select a game or one of its files',
      onSelect: () => exportTarget && exportGame(exportTarget),
    },
    {
      label: 'Cartridge',
      testId: 'files-export-cartridge',
      disabled: !exportTarget,
      title: exportTarget
        ? `Save ${exportTarget} as a playable cartridge (.wasm) with the assets it uses inside`
        : 'Select a game or one of its files',
      onSelect: () => exportTarget && exportGameCartridge(exportTarget),
    },
    {
      label: 'Import',
      testId: 'files-import',
      disabled: !state.writable,
      title: 'Add a game from a zip made by Export',
      onSelect: () => zipInput.current?.click(),
    },
  ];

  return (
    <div className="tf-files" data-testid="files">
      <div className="tf-files-actions">
        {touch ? (
          // The touch layout: the actions in a menu, so the tree starts at the top.
          <AppMenu items={actions} label="Actions ▾" testId="files-menu" />
        ) : (
          actions.map((action) => (
            <button
              key={action.label}
              type="button"
              data-testid={action.testId}
              disabled={action.disabled}
              title={action.title}
              onClick={action.onSelect}
            >
              {action.label}
            </button>
          ))
        )}
        <input
          ref={zipInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          data-testid="files-import-input"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) readZip(file);
          }}
        />
      </div>
      {plan ? (
        <div className="tf-files-confirm" data-testid="files-import-confirm">
          {`${plan.changed.length} asset${plan.changed.length > 1 ? 's differ' : ' differs'} from the project's: ${plan.changed
            .map((f) => f.path.split('/').pop())
            .join(', ')}.`}
          <button type="button" onClick={() => finishImport(plan, true)}>
            Replace them
          </button>
          <button type="button" onClick={() => finishImport(plan, false)}>
            Keep mine
          </button>
          <button type="button" onClick={() => setPlan(null)}>
            Cancel
          </button>
        </div>
      ) : null}
      {edit?.kind === 'delete' ? (
        <div className="tf-files-confirm" data-testid="files-confirm">
          Delete {edit.node.kind === 'folder' ? `the folder ${edit.node.path}` : edit.node.path}? Ctrl+Z undoes it.
          <button type="button" onClick={() => run(editor.workbench.delete(edit.node.path))}>
            Delete
          </button>
          <button type="button" onClick={() => setEdit(null)}>
            Cancel
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="tf-files-error" role="alert">
          {error}
        </div>
      ) : null}
      <ul className="tf-files-tree" ref={treeRef}>
        {SECTIONS.map(({ path, label }) => {
          const node = tree.find((n) => n.path === path);
          return node ? renderSection(node, label) : null;
        })}
      </ul>
    </div>
  );
}
