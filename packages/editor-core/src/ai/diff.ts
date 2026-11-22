// A line diff for showing what the agent changed: the changed lines with a
// little context, from the longest common subsequence of the two texts.

export interface DiffLine {
  kind: ' ' | '+' | '-' | '…';
  text: string;
}

/** Larger files are shown as replaced rather than diffed (the table is lines × lines). */
const MAX_CELLS = 4_000_000;

export function lineDiff(before: string | null, after: string | null, context = 2): DiffLine[] {
  const a = before === null ? [] : before.split('\n');
  const b = after === null ? [] : after.split('\n');
  if (a.length * b.length > MAX_CELLS) {
    return [...a.map((text) => ({ kind: '-' as const, text })), ...b.map((text) => ({ kind: '+' as const, text }))];
  }
  // lcs[i][j]: common lines of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const all: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      all.push({ kind: ' ', text: a[i++] });
      j++;
    } else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      all.push({ kind: '-', text: a[i++] });
    } else {
      all.push({ kind: '+', text: b[j++] });
    }
  }
  // Keep changed lines and `context` lines around them; fold the rest.
  const keep = all.map((l) => l.kind !== ' ');
  const near = all.map((_, k) => keep.slice(Math.max(0, k - context), k + context + 1).some(Boolean));
  const out: DiffLine[] = [];
  for (let k = 0; k < all.length; k++) {
    if (near[k]) out.push(all[k]);
    else if (out.at(-1)?.kind !== '…') out.push({ kind: '…', text: '' });
  }
  return out;
}
