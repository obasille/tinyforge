import { MEMORY_REGIONS, MemoryView, regionAt } from '@tinyforge/editor-core';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../EditorContext.ts';

/**
 * Hex view of a window of memory, refreshed every frame. The rows are rendered
 * by the plain-TS MemoryView; React only owns the controls.
 */
export function MemoryPanel() {
  const editor = useEditor();
  const out = useRef<HTMLPreElement>(null);
  const view = useRef<MemoryView | null>(null);
  const [address, setAddress] = useState(MEMORY_REGIONS.find((r) => r.name === 'Game RAM')?.start ?? 0);
  const [text, setText] = useState('');

  useEffect(() => {
    const el = out.current;
    if (!el) return;
    const v = new MemoryView(el, (offset, length, listener) => editor.host.watch(offset, length, listener));
    view.current = v;
    return () => {
      v.dispose();
      view.current = null;
    };
  }, [editor]);

  useEffect(() => {
    view.current?.setAddress(address);
    setText(`0x${address.toString(16).toUpperCase().padStart(6, '0')}`);
  }, [address]);

  const region = regionAt(address);

  return (
    <div className="tf-memory">
      <div className="tf-memory-bar">
        <select
          value={region?.name ?? ''}
          onChange={(e) => {
            const r = MEMORY_REGIONS.find((x) => x.name === e.target.value);
            if (r) setAddress(r.start);
          }}
        >
          {MEMORY_REGIONS.map((r) => (
            <option key={r.name} value={r.name}>
              {r.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Address"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const n = Number.parseInt(text.replace(/^0x/i, ''), 16);
            if (Number.isFinite(n)) setAddress(n);
          }}
        />
      </div>
      <pre
        ref={out}
        className="tf-hex"
        data-testid="memory-hex"
        onWheel={(e) => {
          const rows = Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 16));
          setAddress((a) => Math.max(0, a + rows * 16));
        }}
      />
    </div>
  );
}
