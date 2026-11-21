// The file tree's model: folders and files built from the project's file
// list. Plain data, so the tree view (React) only renders it.

import type { FileEntry } from './workspace.ts';

export interface TreeNode {
  /** Project path; a folder's has no trailing slash. */
  path: string;
  name: string;
  kind: 'folder' | 'file';
  /** The editor may not change it (a folder: none of its files can be changed). */
  readonly: boolean;
  children: TreeNode[];
  entry?: FileEntry;
}

/** Folders first, then files, each by name. */
function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) =>
    a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  for (const n of nodes) sortTree(n.children);
}

/** The tree for a file list: top-level folders games/, assets/ and engine/. */
export function buildTree(files: readonly FileEntry[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const folders = new Map<string, TreeNode>();
  const folder = (path: string): TreeNode[] => {
    if (path === '') return roots;
    let node = folders.get(path);
    if (!node) {
      const slash = path.lastIndexOf('/');
      node = { path, name: path.slice(slash + 1), kind: 'folder', readonly: true, children: [] };
      folders.set(path, node);
      folder(slash < 0 ? '' : path.slice(0, slash)).push(node);
    }
    return node.children;
  };
  for (const entry of files) {
    const slash = entry.path.lastIndexOf('/');
    const parent = slash < 0 ? '' : entry.path.slice(0, slash);
    folder(parent).push({
      path: entry.path,
      name: entry.path.slice(slash + 1),
      kind: 'file',
      readonly: !!entry.readonly,
      children: [],
      entry,
    });
    // A folder is writable when any file in it is.
    if (!entry.readonly) {
      for (let p = parent; p; p = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '') {
        const node = folders.get(p);
        if (node) node.readonly = false;
      }
    }
  }
  sortTree(roots);
  const order = ['games', 'assets', 'engine'];
  return roots.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

/** Every file path under a tree path (the path itself, for a file). */
export function filesUnder(files: readonly FileEntry[], path: string): string[] {
  return files.filter((f) => f.path === path || f.path.startsWith(`${path}/`)).map((f) => f.path);
}

/** Files the code editor opens (text files). */
export function isTextFile(path: string): boolean {
  return /\.(ts|json|md|txt)$/i.test(path);
}
