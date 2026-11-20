import { createContext, useContext } from 'react';
import type { Editor } from './editor.ts';

export const EditorContext = createContext<Editor | null>(null);

export function useEditor(): Editor {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error('useEditor outside <EditorContext>');
  return editor;
}
