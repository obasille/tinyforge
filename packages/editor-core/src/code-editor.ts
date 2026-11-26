// A code editor for one project file: CodeMirror 6 with TypeScript
// highlighting, compile errors and live asset-scan issues as underlines, and
// asset ID completion in s(), playSfx() and playMusic().
//
// Plain TS: a React panel hands it a container. Saving goes through the
// editor's command stack (so a save can be undone) and the Workspace; the
// file then comes back as a change like any other. When the file changes on
// disk, a clean buffer reloads; an edited one asks (`conflict`).

import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxTree } from '@codemirror/language';
import { forEachDiagnostic, type Diagnostic as LintDiagnostic, linter, lintGutter } from '@codemirror/lint';
import { EditorState, type Extension, StateEffect } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { AssetKind, AssetLibrary } from '@tinyforge/engine/tooling/asset-scan';
import type { Diagnostic } from '@tinyforge/engine/tooling/compiler';
import { basicSetup } from 'codemirror';
import { type AssetUse, assetCallArgument, scanAssets } from './live-scan.ts';
import { createStore, type Store } from './store.ts';

export interface CodeEditorHost {
  /** The file's text on disk, or null when it does not exist. */
  read(path: string): Promise<string | null>;
  /** Save through the command stack; rejects when the write fails. */
  save(path: string, text: string): Promise<void>;
  /** Whether the file can be edited. */
  writable(path: string): boolean;
  /** The asset library, for the live scan and completion. */
  library(): AssetLibrary;
  /** The latest compile diagnostics for this file. */
  diagnostics(path: string): Diagnostic[];
  /** The asset calls in the buffer changed (games/ files only). */
  onUses?(path: string, uses: AssetUse[]): void;
}

export interface CodeEditorState {
  loading: boolean;
  /** Why the file could not be opened or saved. */
  error: string | null;
  /** The buffer differs from the file on disk. */
  dirty: boolean;
  /** The file changed (or was deleted) on disk while the buffer had edits. */
  conflict: null | 'changed' | 'deleted';
  readonly: boolean;
  saving: boolean;
}

const isScript = (path: string) => path.endsWith('.ts');

/** Re-run the linter (compile results or the library changed, not the text). */
const refreshLint = StateEffect.define<null>();
const isGameFile = (path: string) => path.startsWith('games/');

/** Where a compile diagnostic lands in the current text, by line and column. */
function place(doc: EditorState['doc'], d: Diagnostic): { from: number; to: number } {
  const lineNo = Math.min(Math.max(d.line, 1), doc.lines);
  const line = doc.line(lineNo);
  const from = Math.min(line.from + Math.max(d.column - 1, 0), line.to);
  return { from, to: Math.min(from + Math.max(d.to - d.from, 1), doc.length) };
}

export class CodeEditor {
  readonly state: Store<CodeEditorState>;
  private view: EditorView | null = null;
  /** The text on disk, as last loaded or saved. */
  private disk: string | null = null;
  private disposed = false;
  /** A goTo() made while the file was loading. */
  private pendingGoTo: { line: number; column: number } | null = null;

  constructor(
    readonly path: string,
    private readonly parent: HTMLElement,
    private readonly host: CodeEditorHost,
  ) {
    this.state = createStore<CodeEditorState>({
      loading: true,
      error: null,
      dirty: false,
      conflict: null,
      readonly: !host.writable(path),
      saving: false,
    });
    void this.open();
  }

  /** The buffer's text. */
  get text(): string {
    return this.view?.state.doc.toString() ?? '';
  }

  /** Replace the buffer's text as if typed (one undo step in the buffer). */
  setText(text: string): void {
    const view = this.view;
    if (!view) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }

  focus(): void {
    this.view?.focus();
  }

  /** Put the cursor at a character offset and scroll it into view. */
  select(pos: number): void {
    this.view?.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  }

  /** Put the cursor at a 1-based line and column, scroll to it and focus (after loading if needed). */
  goTo(line: number, column = 1): void {
    const view = this.view;
    if (!view) {
      this.pendingGoTo = { line, column };
      return;
    }
    const { from, to } = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
    const anchor = Math.min(from + column - 1, to);
    view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) });
    view.focus();
  }

  private async open(): Promise<void> {
    try {
      const text = await this.host.read(this.path);
      if (this.disposed) return;
      if (text === null) throw new Error(`${this.path} not found`);
      this.disk = text;
      this.view = new EditorView({ parent: this.parent, state: this.createState(text) });
      this.update({ loading: false });
      this.reportUses();
      if (this.pendingGoTo) this.goTo(this.pendingGoTo.line, this.pendingGoTo.column);
    } catch (e) {
      this.update({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  private createState(text: string): EditorState {
    const extensions: Extension[] = [
      basicSetup,
      oneDark,
      EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: 'ui-monospace, monospace' } }),
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            void this.save();
            return true;
          },
        },
      ]),
      EditorState.readOnly.of(this.state.getState().readonly),
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        this.update({ dirty: u.state.doc.toString() !== this.disk });
        this.reportUses();
      }),
      lintGutter(),
      linter((view) => this.lint(view), {
        delay: 150,
        needsRefresh: (u) => u.transactions.some((t) => t.effects.some((e) => e.is(refreshLint))),
      }),
    ];
    if (isScript(this.path)) {
      extensions.push(javascript({ typescript: true }));
      if (isGameFile(this.path)) {
        // One function for the editor's lifetime: completion tracks sources by identity.
        const source = (ctx: CompletionContext) => this.completeAssetId(ctx);
        const data = [{ autocomplete: source }];
        extensions.push(
          autocompletion(),
          EditorState.languageData.of(() => data),
        );
      }
    }
    return EditorState.create({ doc: text, extensions });
  }

  private lint(view: EditorView): LintDiagnostic[] {
    const out: LintDiagnostic[] = [];
    const seen = new Set<string>();
    if (isScript(this.path) && isGameFile(this.path)) {
      const scan = scanAssets(view.state.doc.toString(), this.host.library(), syntaxTree(view.state));
      for (const issue of scan.issues) {
        out.push({ from: issue.from, to: issue.to, severity: 'error', message: issue.message, source: 'assets' });
        seen.add(`${view.state.doc.lineAt(issue.from).number}:${issue.message}`);
      }
    }
    for (const d of this.host.diagnostics(this.path)) {
      if (d.severity === 'info') continue;
      const { from, to } = place(view.state.doc, d);
      const key = `${view.state.doc.lineAt(from).number}:${d.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ from, to, severity: d.severity, message: d.message, source: 'compiler' });
    }
    return out;
  }

  /** Completion of library IDs inside the first argument's string literal. */
  private completeAssetId(ctx: CompletionContext): CompletionResult | null {
    const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
    if (node.name !== 'String') return null;
    let arg: SyntaxNode = node;
    while (
      arg.parent &&
      (arg.parent.name === 'ParenthesizedExpression' || arg.parent.name === 'ConditionalExpression')
    ) {
      arg = arg.parent;
    }
    const call = arg.parent?.name === 'ArgList' ? arg.parent.parent : null;
    if (call?.name !== 'CallExpression') return null;
    const found = assetCallArgument(call, (a, b) => ctx.state.sliceDoc(a, b));
    if (!found || found.arg?.from !== arg.from) return null;
    const kind: AssetKind = found.kind;
    return {
      from: node.from + 1,
      options: [...this.host.library()[kind]].sort().map((id) => ({ label: id, type: 'constant', detail: kind })),
      validFor: /^[\w~-]*$/,
    };
  }

  private reportUses(): void {
    if (!this.view || !isScript(this.path) || !isGameFile(this.path)) return;
    this.host.onUses?.(this.path, scanAssets(this.view.state.doc.toString(), null, syntaxTree(this.view.state)).uses);
  }

  /** The underlines shown now (live scan and compiler), for tests and agents. */
  shownDiagnostics(): Array<{ from: number; to: number; severity: string; message: string }> {
    const out: Array<{ from: number; to: number; severity: string; message: string }> = [];
    if (this.view) {
      forEachDiagnostic(this.view.state, (d, from, to) =>
        out.push({ from, to, severity: d.severity, message: d.message }),
      );
    }
    return out;
  }

  /** Compile results changed: refresh the underlines. */
  refreshDiagnostics(): void {
    this.view?.dispatch({ effects: refreshLint.of(null) });
  }

  /** Write the buffer to disk (Ctrl+S). */
  async save(): Promise<void> {
    const s = this.state.getState();
    if (!this.view || s.readonly || s.saving) return;
    const text = this.text;
    this.update({ saving: true });
    try {
      await this.host.save(this.path, text);
      this.disk = text;
      this.update({ saving: false, error: null, conflict: null, dirty: this.text !== this.disk });
    } catch (e) {
      this.update({ saving: false, error: `Could not save: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  /** The file changed on disk (from any program, or an undo). */
  async diskChanged(kind: 'add' | 'change' | 'unlink'): Promise<void> {
    if (!this.view) return;
    const text = kind === 'unlink' ? null : await this.host.read(this.path);
    if (this.disposed || !this.view) return;
    if (text === this.disk) return; // our own save, or nothing new
    if (text === null) {
      this.disk = null;
      this.update({ conflict: 'deleted', dirty: true });
      return;
    }
    if (!this.state.getState().dirty) {
      this.replaceWith(text);
      return;
    }
    this.disk = text;
    this.update({ conflict: 'changed', dirty: this.text !== text });
  }

  /** Conflict: take the file on disk, dropping the buffer's edits. */
  async reloadFromDisk(): Promise<void> {
    const text = await this.host.read(this.path);
    if (text === null) return;
    this.replaceWith(text);
  }

  /** Conflict: keep the buffer; the next save overwrites the file on disk. */
  keepMine(): void {
    this.update({ conflict: null, dirty: this.text !== this.disk });
  }

  private replaceWith(text: string): void {
    const view = this.view;
    if (!view) return;
    this.disk = text;
    const head = Math.min(view.state.selection.main.head, text.length);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: head },
    });
    this.update({ conflict: null, dirty: false });
  }

  dispose(): void {
    this.disposed = true;
    this.view?.destroy();
    this.view = null;
  }

  private update(patch: Partial<CodeEditorState>): void {
    this.state.setState((s) => ({ ...s, ...patch }));
  }
}
