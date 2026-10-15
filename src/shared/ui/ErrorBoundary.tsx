import { Component, type ErrorInfo, type ReactNode } from 'react';
import { describeError } from '../api/errors';
import { ErrorPanel } from './Region';

interface Props {
  children: ReactNode;
  label: string;
  /** Changing this key resets the boundary (e.g. when the route changes). */
  resetKey?: string;
}
interface S {
  error: unknown;
  key?: string;
}

/** One boundary per view: a crash in one view never takes the shell down. */
export class ViewBoundary extends Component<Props, S> {
  state: S = { error: null };
  static getDerivedStateFromError(error: unknown): S {
    return { error };
  }
  static getDerivedStateFromProps(props: Props, state: S): Partial<S> | null {
    if (props.resetKey !== state.key) return { key: props.resetKey, error: null };
    return null;
  }
  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[SmartMask] ${this.props.label} crashed`, error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      const d = describeError(this.state.error);
      return (
        <ErrorPanel
          code={d.code === 'SM-UI-001' ? 'SM-UI-001' : d.code}
          message={`The ${this.props.label} view hit an unexpected error. The rest of the console is unaffected.`}
          technical={d.technical}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}
