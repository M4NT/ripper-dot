import { Component } from 'react';

/** Isola um efeito visual: falha de chunk ou de render não sobe até o Guard da raiz. */
export class FxBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return this.props.fallback ?? null;
    return this.props.children;
  }
}
