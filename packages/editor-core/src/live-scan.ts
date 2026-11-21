// The live asset scan: the same rules as the compile scan
// (engine tooling/asset-scan.ts), run on unsaved code as it is typed.
//
// It reads the Lezer syntax tree of the buffer (the one CodeMirror already
// keeps for highlighting) and finds every s(), playSfx() and playMusic()
// call. The first argument must be a string literal or a `cond ? "a" : "b"`
// choice between literals, and each ID must be in the library. The compile
// scan stays the authority; this one gives instant underlines, ID
// autocomplete, and "used" for code that has not compiled yet.

import type { SyntaxNode, Tree } from '@lezer/common';
import { parser } from '@lezer/javascript';
import type { AssetKind, AssetLibrary } from '@tinyforge/engine/tooling/asset-scan';

const tsParser = parser.configure({ dialect: 'ts' });

/** Which asset kind each SDK function takes as its first argument. */
export const ASSET_CALLS: Readonly<Record<string, AssetKind>> = { s: 'sprites', playSfx: 'sfx', playMusic: 'music' };

const NOUN: Record<AssetKind, string> = { sprites: 'sprite', sfx: 'sound effect', music: 'music track' };

export interface AssetUse {
  kind: AssetKind;
  id: string;
  /** Range of the string literal, quotes included. */
  from: number;
  to: number;
}

export interface ScanIssue {
  from: number;
  to: number;
  message: string;
}

export interface LiveScan {
  uses: AssetUse[];
  issues: ScanIssue[];
}

/** The value of a JS string literal's source text. */
export function stringValue(literal: string): string {
  const body = literal.slice(1, -1);
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e: string) => {
    if (e.startsWith('u{')) return String.fromCodePoint(Number.parseInt(e.slice(2, -1), 16));
    if (e[0] === 'u' || e[0] === 'x') return String.fromCharCode(Number.parseInt(e.slice(1), 16));
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' } as Record<string, string>)[e] ?? e;
  });
}

/** The string literals an argument can evaluate to, or null if it is not literal. */
function literalChoices(node: SyntaxNode): SyntaxNode[] | null {
  if (node.name === 'String') return [node];
  if (node.name === 'ParenthesizedExpression') {
    const inner = node.firstChild?.nextSibling;
    return inner && inner.name !== ')' ? literalChoices(inner) : null;
  }
  if (node.name === 'ConditionalExpression') {
    const parts: SyntaxNode[] = [];
    for (let c = node.firstChild; c; c = c.nextSibling) if (c.name !== 'LogicOp') parts.push(c);
    if (parts.length !== 3) return null;
    const a = literalChoices(parts[1]);
    const b = literalChoices(parts[2]);
    return a && b ? [...a, ...b] : null;
  }
  return null;
}

/** The first argument of an asset call, and the call's kind, for a CallExpression node. */
export function assetCallArgument(
  call: SyntaxNode,
  text: (from: number, to: number) => string,
): { fn: string; kind: AssetKind; arg: SyntaxNode | null } | null {
  const callee = call.firstChild;
  if (callee?.name !== 'VariableName') return null;
  const fn = text(callee.from, callee.to);
  const kind = ASSET_CALLS[fn];
  if (!kind) return null;
  const args = callee.nextSibling;
  if (args?.name !== 'ArgList') return null;
  const first = args.firstChild?.nextSibling ?? null;
  return { fn, kind, arg: first && first.name !== ')' && first.name !== ',' ? first : null };
}

/** Scan a buffer. Pass CodeMirror's tree to skip parsing; `library` null skips the ID check. */
export function scanAssets(
  source: string,
  library: AssetLibrary | null,
  tree: Tree = tsParser.parse(source),
): LiveScan {
  const uses: AssetUse[] = [];
  const issues: ScanIssue[] = [];
  const text = (from: number, to: number) => source.slice(from, to);
  tree.iterate({
    enter(ref) {
      if (ref.name !== 'CallExpression') return;
      const found = assetCallArgument(ref.node, text);
      if (!found?.arg) return;
      const { fn, kind, arg } = found;
      const choices = literalChoices(arg);
      if (!choices) {
        issues.push({
          from: arg.from,
          to: arg.to,
          message: `${fn}() needs the ${NOUN[kind]} ID as a string literal, like ${fn}("name").`,
        });
        return;
      }
      for (const literal of choices) {
        const id = stringValue(text(literal.from, literal.to));
        uses.push({ kind, id, from: literal.from, to: literal.to });
        if (library && !library[kind].has(id)) {
          issues.push({
            from: literal.from,
            to: literal.to,
            message: `Unknown ${NOUN[kind]} "${id}": no file with that ID in assets/${kind}.`,
          });
        }
      }
    },
  });
  return { uses, issues };
}
