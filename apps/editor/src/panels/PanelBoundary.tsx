import { Component, type FunctionComponent, type ReactNode } from 'react';

interface State {
  error: Error | null;
  key: number;
}

/** One error boundary per panel: a crash shows a message and a reload button. */
class PanelBoundary extends Component<{ title: string; children: (key: number) => ReactNode }, State> {
  state: State = { error: null, key: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error(`[${this.props.title} panel]`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="tf-panel-error" role="alert">
          <p>
            The {this.props.title} panel crashed: {this.state.error.message}
          </p>
          <button type="button" onClick={() => this.setState((s) => ({ error: null, key: s.key + 1 }))}>
            Reload panel
          </button>
        </div>
      );
    }
    return this.props.children(this.state.key);
  }
}

export function withBoundary<P extends object>(title: string, Panel: FunctionComponent<P>): FunctionComponent<P> {
  const Wrapped = (props: P) => <PanelBoundary title={title}>{(key) => <Panel key={key} {...props} />}</PanelBoundary>;
  Wrapped.displayName = `${title}Panel`;
  return Wrapped;
}
