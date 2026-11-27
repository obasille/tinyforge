// What a panel may ask of whatever shows it: Dockview on the desktop, the
// touch panels (TouchPanels.tsx) on phones. Dockview's own panel props fit
// this as they are.

export interface PanelApi {
  /** Whether the panel is the one shown and focused in its place. */
  readonly isActive: boolean;
  /** The tab title (the file name, with ● for unsaved changes). */
  setTitle(title: string): void;
  /** Updates the panel's parameters, such as the path after a rename. */
  updateParameters(params: { path: string }): void;
}

export interface PanelProps<P = Record<string, never>> {
  api: PanelApi;
  params: P;
}
